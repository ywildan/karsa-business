package com.ywldan.karsabusiness.data.local

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface KarsaDao {
    @Query("SELECT * FROM businesses WHERE ownerId = :ownerId LIMIT 1")
    fun observeBusiness(ownerId: String): Flow<BusinessEntity?>

    @Query("SELECT * FROM businesses WHERE ownerId = :ownerId LIMIT 1")
    suspend fun getBusiness(ownerId: String): BusinessEntity?

    @Query("SELECT * FROM businesses WHERE ownerId = :ownerId ORDER BY createdAt, id")
    fun observeBusinesses(ownerId: String): Flow<List<BusinessEntity>>

    @Query("SELECT * FROM businesses WHERE ownerId = :ownerId ORDER BY createdAt, id")
    suspend fun getBusinesses(ownerId: String): List<BusinessEntity>

    @Query("SELECT * FROM businesses WHERE id = :id")
    suspend fun getBusinessById(id: String): BusinessEntity?

    @Query("DELETE FROM businesses WHERE id = :id AND ownerId = :ownerId")
    suspend fun deleteBusinessById(ownerId: String, id: String)

    @Query("UPDATE transactions SET businessId = :newId WHERE ownerId = :ownerId AND businessId = :oldId")
    suspend fun reassignBusinessTransactions(ownerId: String, oldId: String, newId: String)

    @Query("UPDATE products SET businessId = :newId WHERE ownerId = :ownerId AND businessId = :oldId")
    suspend fun reassignBusinessProducts(ownerId: String, oldId: String, newId: String)

    @Transaction
    suspend fun applyMultiSnapshot(ownerId: String, businesses: List<BusinessEntity>, products: List<ProductEntity>, transactions: List<TransactionEntity>, bootstrapId: String? = null) {
        val local = getBusinesses(ownerId)
        // Only the offline first-business bootstrap can have a different canonical ID.
        // Additional businesses are created on the server and never remapped.
        val first = local.singleOrNull()
        if (first != null && first.syncStatus == "PENDING" && businesses.isNotEmpty() && businesses.none { it.id == first.id }) {
            val canonical = businesses.find { it.id == bootstrapId } ?: businesses.first()
            deleteBusinessById(ownerId, first.id)
            upsertBusiness(if (first.updatedAt > canonical.updatedAt) first.copy(id = canonical.id) else canonical)
            reassignBusinessTransactions(ownerId, first.id, canonical.id)
            reassignBusinessProducts(ownerId, first.id, canonical.id)
        }
        businesses.forEach { incoming ->
            val existing = getBusinessById(incoming.id)
            if (existing == null || incoming.updatedAt >= existing.updatedAt) upsertBusiness(incoming)
        }
        syncProducts(products)
        syncTransactions(transactions)
    }

    @Upsert
    suspend fun upsertBusiness(business: BusinessEntity)

    @Query("""SELECT (SELECT COUNT(*) FROM transactions WHERE ownerId = :ownerId AND syncStatus = 'PENDING') +
        (SELECT COUNT(*) FROM products WHERE ownerId = :ownerId AND syncStatus = 'PENDING') +
        (SELECT COUNT(*) FROM businesses WHERE ownerId = :ownerId AND syncStatus = 'PENDING')""")
    fun observePendingCount(ownerId: String): Flow<Int>

    @Query(
        """SELECT * FROM transactions
           WHERE ownerId = :ownerId AND deletedAt IS NULL
           ORDER BY transactionDate DESC, createdAt DESC""",
    )
    fun observeTransactions(ownerId: String): Flow<List<TransactionEntity>>

    @Query("SELECT * FROM transactions WHERE id = :id LIMIT 1")
    suspend fun getTransaction(id: String): TransactionEntity?

    @Query("SELECT * FROM transactions WHERE ownerId = :ownerId AND syncStatus = 'PENDING'")
    suspend fun getPendingTransactions(ownerId: String): List<TransactionEntity>

    @Upsert
    suspend fun upsertTransaction(transaction: TransactionEntity)

    @Upsert
    suspend fun upsertTransactions(transactions: List<TransactionEntity>)

    @Query("UPDATE transactions SET deletedAt = :deletedAt, updatedAt = :deletedAt, syncStatus = 'PENDING' WHERE id = :id")
    suspend fun softDeleteTransaction(id: String, deletedAt: Long)

    // ---- Products ----

    @Query("SELECT * FROM products WHERE ownerId = :ownerId AND deletedAt IS NULL ORDER BY name")
    fun observeProducts(ownerId: String): Flow<List<ProductEntity>>

    @Query("SELECT * FROM products WHERE id = :id LIMIT 1")
    suspend fun getProduct(id: String): ProductEntity?

    @Query("SELECT * FROM products WHERE ownerId = :ownerId AND syncStatus = 'PENDING'")
    suspend fun getPendingProducts(ownerId: String): List<ProductEntity>

    @Upsert
    suspend fun upsertProduct(product: ProductEntity)

    @Upsert
    suspend fun upsertProducts(products: List<ProductEntity>)

    @Query("UPDATE products SET deletedAt = :deletedAt, updatedAt = :deletedAt, syncStatus = 'PENDING' WHERE id = :id")
    suspend fun softDeleteProduct(id: String, deletedAt: Long)

    /** Applies remote products, keeping the locally newer row on conflict. */
    @Transaction
    suspend fun syncProducts(remote: List<ProductEntity>) {
        remote.forEach { incoming ->
            val local = getProduct(incoming.id)
            upsertProduct(mergeSyncedProduct(local, incoming))
        }
    }

    /** Applies remote transactions, keeping the locally newer row on conflict. */
    @Transaction
    suspend fun syncTransactions(remote: List<TransactionEntity>) {
        remote.forEach { incoming ->
            val local = getTransaction(incoming.id)
            if (local == null || incoming.updatedAt >= local.updatedAt) {
                upsertTransaction(incoming)
            }
        }
    }

    /**
     * Saves a transaction and applies its product stock effect atomically.
     * Reverts the previous product link (if any), then applies the new one.
     */
    @Transaction
    suspend fun saveTransactionWithProduct(newTx: TransactionEntity, oldTx: TransactionEntity?) {
        oldTx?.productId?.let { productId ->
            val qty = oldTx.quantity ?: 1L
            getProduct(productId)?.let { product ->
                upsertProduct(
                    product.copy(
                        stock = product.stock + qty,
                        updatedAt = newTx.updatedAt,
                        syncStatus = SyncStatus.PENDING,
                    ),
                )
            }
        }
        newTx.productId?.let { productId ->
            val qty = newTx.quantity ?: 1L
            val product = getProduct(productId) ?: error("Produk tidak ditemukan")
            check(product.ownerId == newTx.ownerId && product.businessId == newTx.businessId) { "Produk berasal dari bisnis lain" }
            check(product.deletedAt == null) { "Produk sudah dihapus" }
            check(product.stock >= qty) {
                "Stok ${product.name} tidak mencukupi (tersisa ${product.stock})"
            }
            upsertProduct(
                product.copy(
                    stock = product.stock - qty,
                    updatedAt = newTx.updatedAt,
                    syncStatus = SyncStatus.PENDING,
                ),
            )
        }
        upsertTransaction(newTx)
    }

    /** Soft-deletes a transaction and restores the linked product stock atomically. */
    @Transaction
    suspend fun deleteTransactionWithStockRevert(id: String, deletedAt: Long) {
        val tx = getTransaction(id) ?: return
        tx.productId?.let { productId ->
            val qty = tx.quantity ?: 1L
            getProduct(productId)?.let { product ->
                upsertProduct(
                    product.copy(
                        stock = product.stock + qty,
                        updatedAt = deletedAt,
                        syncStatus = SyncStatus.PENDING,
                    ),
                )
            }
        }
        softDeleteTransaction(id, deletedAt)
    }
}

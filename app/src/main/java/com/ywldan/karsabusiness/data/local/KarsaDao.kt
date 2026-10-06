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

    @Upsert
    suspend fun upsertBusiness(business: BusinessEntity)

    @Query("DELETE FROM businesses WHERE ownerId = :ownerId")
    suspend fun deleteBusinessForOwner(ownerId: String)

    @Query("UPDATE transactions SET businessId = :businessId WHERE ownerId = :ownerId")
    suspend fun reassignTransactions(ownerId: String, businessId: String)

    @Query("UPDATE products SET businessId = :businessId WHERE ownerId = :ownerId")
    suspend fun reassignProducts(ownerId: String, businessId: String)

    @Query("""SELECT (SELECT COUNT(*) FROM transactions WHERE ownerId = :ownerId AND syncStatus = 'PENDING') +
        (SELECT COUNT(*) FROM products WHERE ownerId = :ownerId AND syncStatus = 'PENDING') +
        (SELECT COUNT(*) FROM businesses WHERE ownerId = :ownerId AND syncStatus = 'PENDING')""")
    fun observePendingCount(ownerId: String): Flow<Int>

    @Transaction
    suspend fun applySnapshot(business: BusinessEntity?, products: List<ProductEntity>, transactions: List<TransactionEntity>) {
        if (business != null) {
            val local = getBusiness(business.ownerId)
            // Adopt the canonical ID while retaining newer offline business edits.
            replaceBusiness(if (local != null && local.updatedAt > business.updatedAt) local.copy(id = business.id) else business)
        }
        syncProducts(products)
        syncTransactions(transactions)
    }

    @Transaction
    suspend fun replaceBusiness(business: BusinessEntity) {
        deleteBusinessForOwner(business.ownerId)
        upsertBusiness(business)
        reassignTransactions(business.ownerId, business.id)
        reassignProducts(business.ownerId, business.id)
    }

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
            if (local == null || incoming.updatedAt >= local.updatedAt) {
                upsertProduct(incoming)
            }
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

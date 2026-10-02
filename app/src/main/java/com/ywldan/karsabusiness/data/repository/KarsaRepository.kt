package com.ywldan.karsabusiness.data.repository

import android.content.Context
import com.ywldan.karsabusiness.data.local.BusinessEntity
import com.ywldan.karsabusiness.data.local.KarsaDao
import com.ywldan.karsabusiness.data.local.ProductEntity
import com.ywldan.karsabusiness.data.local.TransactionEntity
import com.ywldan.karsabusiness.data.local.SyncStatus
import com.ywldan.karsabusiness.data.sync.SyncScheduler
import kotlinx.coroutines.flow.Flow
import java.util.UUID

class KarsaRepository(
    private val dao: KarsaDao,
    private val context: Context,
) {
    fun observeBusiness(ownerId: String): Flow<BusinessEntity?> = dao.observeBusiness(ownerId)
    fun observeTransactions(ownerId: String): Flow<List<TransactionEntity>> = dao.observeTransactions(ownerId)

    suspend fun createBusiness(ownerId: String, name: String, type: String, initialCapital: Long) {
        val now = System.currentTimeMillis()
        dao.upsertBusiness(
            BusinessEntity(
                id = UUID.randomUUID().toString(),
                ownerId = ownerId,
                name = name.trim(),
                type = type,
                initialCapital = initialCapital,
                createdAt = now,
                updatedAt = now,
            ),
        )
        SyncScheduler.enqueue(context)
    }

    suspend fun saveTransaction(
        existingId: String?,
        ownerId: String,
        businessId: String,
        type: String,
        amount: Long,
        category: String,
        paymentMethod: String,
        note: String,
        transactionDate: Long,
        productId: String? = null,
        quantity: Long? = null,
    ) {
        require(amount > 0) { "Nominal harus lebih dari 0" }
        // Product links only apply to sales (INCOME); expenses clear the link.
        val linkedProductId = if (type == "INCOME") productId else null
        val linkedQuantity = if (type == "INCOME") quantity else null
        if (linkedProductId != null) {
            require((linkedQuantity ?: 0L) > 0) { "Jumlah produk harus lebih dari 0" }
        }
        val now = System.currentTimeMillis()
        val previous = if (existingId != null) dao.getTransaction(existingId) else null
        val tx = TransactionEntity(
            id = previous?.id ?: UUID.randomUUID().toString(),
            ownerId = ownerId,
            businessId = businessId,
            type = type,
            amount = amount,
            category = category.ifBlank { "Lainnya" },
            paymentMethod = paymentMethod,
            note = note.trim(),
            transactionDate = transactionDate,
            createdAt = previous?.createdAt ?: now,
            updatedAt = now,
            deletedAt = null,
            syncStatus = SyncStatus.PENDING,
            productId = linkedProductId,
            quantity = linkedQuantity,
        )
        // Atomic: revert previous stock effect, apply new one, then save.
        dao.saveTransactionWithProduct(tx, previous)
        SyncScheduler.enqueue(context)
    }

    suspend fun deleteTransaction(id: String) {
        dao.deleteTransactionWithStockRevert(id, System.currentTimeMillis())
        SyncScheduler.enqueue(context)
    }

    // ---- Products ----

    fun observeProducts(ownerId: String): Flow<List<ProductEntity>> = dao.observeProducts(ownerId)

    suspend fun createProduct(
        ownerId: String,
        businessId: String,
        name: String,
        price: Long,
        stock: Long,
    ) {
        require(name.isNotBlank()) { "Nama produk wajib diisi" }
        require(price >= 0) { "Harga tidak boleh negatif" }
        require(stock >= 0) { "Stok awal tidak boleh negatif" }
        val now = System.currentTimeMillis()
        dao.upsertProduct(
            ProductEntity(
                id = UUID.randomUUID().toString(),
                ownerId = ownerId,
                businessId = businessId,
                name = name.trim(),
                price = price,
                stock = stock,
                createdAt = now,
                updatedAt = now,
            ),
        )
        SyncScheduler.enqueue(context)
    }

    suspend fun updateProduct(product: ProductEntity, name: String, price: Long, stock: Long) {
        require(name.isNotBlank()) { "Nama produk wajib diisi" }
        require(price >= 0) { "Harga tidak boleh negatif" }
        require(stock >= 0) { "Stok tidak boleh negatif" }
        dao.upsertProduct(
            product.copy(
                name = name.trim(),
                price = price,
                stock = stock,
                updatedAt = System.currentTimeMillis(),
                syncStatus = SyncStatus.PENDING,
            ),
        )
        SyncScheduler.enqueue(context)
    }

    /**
     * Adjusts stock atomically: positive delta = restock, negative = decrease.
     * Throws when the result would go below zero.
     */
    suspend fun adjustStock(productId: String, delta: Long) {
        require(delta != 0L) { "Jumlah penyesuaian tidak boleh nol" }
        val product = dao.getProduct(productId) ?: error("Produk tidak ditemukan")
        val newStock = product.stock + delta
        require(newStock >= 0) { "Stok ${product.name} tidak mencukupi (tersisa ${product.stock})" }
        dao.upsertProduct(
            product.copy(
                stock = newStock,
                updatedAt = System.currentTimeMillis(),
                syncStatus = SyncStatus.PENDING,
            ),
        )
        SyncScheduler.enqueue(context)
    }

    suspend fun deleteProduct(id: String) {
        dao.softDeleteProduct(id, System.currentTimeMillis())
        SyncScheduler.enqueue(context)
    }
}

package com.ywldan.karsabusiness.data.repository

import android.content.Context
import com.ywldan.karsabusiness.data.local.BusinessEntity
import com.ywldan.karsabusiness.data.local.KarsaDao
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
    ) {
        val now = System.currentTimeMillis()
        val previous = if (existingId != null) dao.getTransaction(existingId) else null
        dao.upsertTransaction(
            TransactionEntity(
                id = previous?.id ?: UUID.randomUUID().toString(),
                ownerId = ownerId,
                businessId = businessId,
                type = type,
                amount = amount,
                category = category,
                paymentMethod = paymentMethod,
                note = note.trim(),
                transactionDate = transactionDate,
                createdAt = previous?.createdAt ?: now,
                updatedAt = now,
                deletedAt = null,
                syncStatus = SyncStatus.PENDING,
            ),
        )
        SyncScheduler.enqueue(context)
    }

    suspend fun deleteTransaction(id: String) {
        dao.softDeleteTransaction(id, System.currentTimeMillis())
        SyncScheduler.enqueue(context)
    }
}

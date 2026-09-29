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

    @Transaction
    suspend fun replaceBusiness(business: BusinessEntity) {
        deleteBusinessForOwner(business.ownerId)
        upsertBusiness(business)
        reassignTransactions(business.ownerId, business.id)
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
}

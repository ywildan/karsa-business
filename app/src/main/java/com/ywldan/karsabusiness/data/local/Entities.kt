package com.ywldan.karsabusiness.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "businesses",
    indices = [Index(value = ["ownerId"], unique = true)],
)
data class BusinessEntity(
    @PrimaryKey val id: String,
    val ownerId: String,
    val name: String,
    val type: String,
    val initialCapital: Long,
    val createdAt: Long,
    val updatedAt: Long,
    val syncStatus: String = SyncStatus.PENDING,
)

@Entity(
    tableName = "transactions",
    indices = [Index("ownerId"), Index("businessId"), Index("transactionDate")],
)
data class TransactionEntity(
    @PrimaryKey val id: String,
    val ownerId: String,
    val businessId: String,
    val type: String,
    val amount: Long,
    val category: String,
    val paymentMethod: String,
    val note: String,
    val transactionDate: Long,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long? = null,
    val syncStatus: String = SyncStatus.PENDING,
)

object TransactionType {
    const val INCOME = "INCOME"
    const val EXPENSE = "EXPENSE"
}

object SyncStatus {
    const val PENDING = "PENDING"
    const val SYNCED = "SYNCED"
}


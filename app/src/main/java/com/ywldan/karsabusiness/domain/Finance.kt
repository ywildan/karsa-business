package com.ywldan.karsabusiness.domain

import com.ywldan.karsabusiness.data.local.ProductEntity
import com.ywldan.karsabusiness.data.local.TransactionEntity
import com.ywldan.karsabusiness.data.local.TransactionType

data class FinanceSummary(
    val income: Long,
    val expense: Long,
    val profit: Long,
    val balance: Long,
)

fun calculateSummary(initialCapital: Long, transactions: List<TransactionEntity>): FinanceSummary {
    val active = transactions.filter { it.deletedAt == null }
    val income = active.filter { it.type == TransactionType.INCOME }.sumOf { it.amount }
    val expense = active.filter { it.type == TransactionType.EXPENSE }.sumOf { it.amount }
    return FinanceSummary(
        income = income,
        expense = expense,
        profit = income - expense,
        balance = initialCapital + income - expense,
    )
}

fun isAllowedCampusEmail(email: String): Boolean =
    email.trim().lowercase().endsWith("@students.untidar.ac.id")


data class InventorySummary(
    val totalProducts: Int = 0,
    val totalStock: Long = 0L,
    val inventoryValue: Long = 0L,
)

fun calculateInventory(products: List<ProductEntity>): InventorySummary {
    val active = products.filter { it.deletedAt == null }
    return InventorySummary(
        totalProducts = active.size,
        totalStock = active.sumOf { it.stock },
        inventoryValue = active.sumOf { it.stock * it.price },
    )
}

/** Flags products that are running low so the UI can warn the user. */
fun isLowStock(stock: Long): Boolean = stock <= 5

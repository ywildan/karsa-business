package com.ywldan.karsabusiness.domain

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


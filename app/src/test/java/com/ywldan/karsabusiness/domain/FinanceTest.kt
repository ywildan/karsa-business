package com.ywldan.karsabusiness.domain

import com.ywldan.karsabusiness.data.local.TransactionEntity
import com.ywldan.karsabusiness.data.local.TransactionType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FinanceTest {
    private fun transaction(type: String, amount: Long) = TransactionEntity(
        id = "$type-$amount",
        ownerId = "owner",
        businessId = "business",
        type = type,
        amount = amount,
        category = "Lainnya",
        paymentMethod = "Tunai",
        note = "",
        transactionDate = 1,
        createdAt = 1,
        updatedAt = 1,
    )

    @Test
    fun summaryIncludesCapitalIncomeAndExpense() {
        val result = calculateSummary(
            initialCapital = 100_000,
            transactions = listOf(
                transaction(TransactionType.INCOME, 250_000),
                transaction(TransactionType.EXPENSE, 75_000),
            ),
        )
        assertEquals(250_000, result.income)
        assertEquals(75_000, result.expense)
        assertEquals(175_000, result.profit)
        assertEquals(275_000, result.balance)
    }

    @Test
    fun campusDomainIsStrict() {
        assertTrue(isAllowedCampusEmail("nama@students.untidar.ac.id"))
        assertFalse(isAllowedCampusEmail("nama@untidar.ac.id"))
        assertFalse(isAllowedCampusEmail("nama@students.untidar.ac.id.example.com"))
    }
}


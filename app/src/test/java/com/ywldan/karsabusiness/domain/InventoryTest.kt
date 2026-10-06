package com.ywldan.karsabusiness.domain

import com.ywldan.karsabusiness.data.local.ProductEntity
import java.math.BigInteger
import org.junit.Assert.assertEquals
import org.junit.Test

class InventoryTest {
    @Test fun inventoryDoesNotOverflowForAcceptedPriceAndStock() {
        val product = ProductEntity("p", "u", "b", "Produk", 999999999999, 999999999, 1, 1)
        val expected = BigInteger("999999999999") * BigInteger("999999999")
        assertEquals(expected, calculateInventory(listOf(product)).inventoryValue)
        assertEquals(BigInteger.ZERO, calculateInventory(listOf(product.copy(deletedAt = 2))).inventoryValue)
    }
}

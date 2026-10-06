package com.ywldan.karsabusiness.data.sync

import com.ywldan.karsabusiness.data.local.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class MultiBusinessSyncEngineTest {
    private val a = BusinessEntity("a", "owner", "Usaha A", "Toko", 0, 100, 100, SyncStatus.SYNCED)
    private val b = a.copy(id = "b", name = "Usaha B")
    private fun sale(id: String, business: String, product: String? = null) = TransactionEntity(id, "owner", business, "INCOME", 10, "Penjualan", "Tunai", "", 100, 100, 100, productId = product, quantity = product?.let { 1 })
    private class Store(val businesses: MutableList<BusinessEntity>, val products: MutableMap<String, ProductEntity>, val sales: MutableMap<String, TransactionEntity>) : MultiBusinessStore {
        override suspend fun businesses() = businesses.toList()
        override suspend fun pendingProducts() = products.values.filter { it.syncStatus == SyncStatus.PENDING }
        override suspend fun pendingTransactions() = sales.values.filter { it.syncStatus == SyncStatus.PENDING }
        override suspend fun apply(snapshot: BusinessSnapshot) {
            snapshot.businesses.forEach { incoming ->
                val index = businesses.indexOfFirst { it.id == incoming.id }
                if (index < 0) businesses.add(incoming) else if (incoming.updatedAt >= businesses[index].updatedAt) businesses[index] = incoming
            }
            snapshot.products.forEach { if (it.updatedAt >= (products[it.id]?.updatedAt ?: 0)) products[it.id] = it }
            snapshot.transactions.forEach { if (it.updatedAt >= (sales[it.id]?.updatedAt ?: 0)) sales[it.id] = it }
        }
    }
    private class Remote(val businesses: List<BusinessEntity>, val writable: Set<String>) : MultiBusinessRemote {
        val calls = mutableListOf<Triple<String, Int, Int>>()
        val products = mutableMapOf<String, ProductEntity>()
        val sales = mutableMapOf<String, TransactionEntity>()
        override suspend fun snapshot() = BusinessSnapshot(businesses, products.values.toList(), sales.values.toList(), writable)
        override suspend fun upload(business: BusinessEntity, products: List<ProductEntity>, transactions: List<TransactionEntity>): BusinessSnapshot {
            check(business.id in writable)
            check(products.all { it.businessId == business.id })
            check(transactions.all { it.businessId == business.id })
            calls += Triple(business.id, products.size, transactions.size)
            products.forEach { this.products[it.id] = it.copy(syncStatus = SyncStatus.SYNCED) }
            transactions.forEach { check(it.productId == null || this.products.containsKey(it.productId)); sales[it.id] = it.copy(syncStatus = SyncStatus.SYNCED) }
            return snapshot()
        }
    }
    @Test fun twoBusinessesStaySeparateAndProductsPrecedeSales() = runTest {
        val product = ProductEntity("pa", "owner", "a", "Kopi", 10, 5, 100, 100)
        val local = Store(mutableListOf(a,b), mutableMapOf(product.id to product), mutableMapOf("ta" to sale("ta","a","pa"), "tb" to sale("tb","b")))
        val remote = Remote(listOf(a,b),setOf("a","b"))
        MultiBusinessSyncEngine(local,remote).sync()
        assertEquals(listOf(Triple("a",1,0),Triple("a",0,1),Triple("b",0,1)),remote.calls)
        assertEquals("a",remote.sales["ta"]?.businessId)
        assertEquals("b",remote.sales["tb"]?.businessId)
        assertTrue(local.pendingTransactions().isEmpty())
    }
    @Test fun expiredPremiumHoldsOtherBusinessChangesWithoutDroppingThem() = runTest {
        val local = Store(mutableListOf(a,b),mutableMapOf(),mutableMapOf("ta" to sale("ta","a"),"tb" to sale("tb","b")))
        val remote = Remote(listOf(a,b),setOf("a"))
        MultiBusinessSyncEngine(local,remote).sync()
        assertEquals(listOf(Triple("a",0,1)),remote.calls)
        assertEquals(listOf("tb"),local.pendingTransactions().map { it.id })
        assertEquals("b",local.sales["tb"]?.businessId)
    }
    @Test fun batchesAreSplitWithinEachBusiness() = runTest {
        val rows = (0..400).map { sale("a$it","a") } + (0..400).map { sale("b$it","b") }
        val local = Store(mutableListOf(a,b),mutableMapOf(),rows.associateBy { it.id }.toMutableMap())
        val remote = Remote(listOf(a,b),setOf("a","b"))
        MultiBusinessSyncEngine(local,remote).sync()
        assertEquals(listOf(Triple("a",0,400),Triple("a",0,1),Triple("b",0,400),Triple("b",0,1)),remote.calls)
        assertEquals(802,remote.sales.size)
    }
}

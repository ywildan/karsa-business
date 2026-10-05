package com.ywldan.karsabusiness.data.sync

import com.ywldan.karsabusiness.data.local.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class SyncEngineTest {
    private val business = BusinessEntity("local-business", "owner", "Usaha", "Toko", 0, 100, 100)
    private fun product(index: Int) = ProductEntity("p$index", "owner", business.id, "Produk", 10, 20, 100, 100)
    private fun sale(index: Int, productId: String? = null) = TransactionEntity(
        "t$index", "owner", business.id, "INCOME", 10, "Penjualan", "Tunai", "", 100, 100, 100,
        productId = productId, quantity = productId?.let { 1 },
    )

    private class Store(var current: BusinessEntity?, val products: MutableMap<String, ProductEntity>, val sales: MutableMap<String, TransactionEntity>) : SyncStore {
        override suspend fun business() = current
        override suspend fun pendingProducts() = products.values.filter { it.syncStatus == SyncStatus.PENDING }
        override suspend fun pendingTransactions() = sales.values.filter { it.syncStatus == SyncStatus.PENDING }
        override suspend fun apply(snapshot: SyncSnapshot) {
            snapshot.business?.let { b ->
                current = b
                products.replaceAll { _, p -> p.copy(businessId = b.id) }
                sales.replaceAll { _, t -> t.copy(businessId = b.id) }
            }
            snapshot.products.forEach { p -> if (p.updatedAt >= (products[p.id]?.updatedAt ?: 0)) products[p.id] = p }
            snapshot.transactions.forEach { t -> if (t.updatedAt >= (sales[t.id]?.updatedAt ?: 0)) sales[t.id] = t }
        }
    }
    private class Remote(var current: BusinessEntity?) : SyncRemote {
        val products = mutableMapOf<String, ProductEntity>()
        val sales = mutableMapOf<String, TransactionEntity>()
        val sizes = mutableListOf<Pair<Int, Int>>()
        var failAt = -1
        var afterUpload: (() -> Unit)? = null
        override suspend fun snapshot() = SyncSnapshot(current, products.values.toList(), sales.values.toList())
        override suspend fun upload(business: BusinessEntity, products: List<ProductEntity>, transactions: List<TransactionEntity>): SyncSnapshot {
            require(products.size <= 500 && transactions.size <= 500)
            if (sizes.size == failAt) error("Connection lost")
            sizes += products.size to transactions.size
            if (current == null) current = business.copy(syncStatus = SyncStatus.SYNCED)
            val canonical = requireNotNull(current).id
            require((products + transactions).all {
                when (it) { is ProductEntity -> it.businessId == business.id; is TransactionEntity -> it.businessId == business.id; else -> false }
            })
            products.forEach { this.products[it.id] = it.copy(businessId = canonical, syncStatus = SyncStatus.SYNCED) }
            transactions.forEach {
                require(it.productId == null || this.products.containsKey(it.productId))
                sales[it.id] = it.copy(businessId = canonical, syncStatus = SyncStatus.SYNCED)
            }
            afterUpload?.invoke()
            return snapshot()
        }
    }
    private fun store(products: List<ProductEntity> = emptyList(), sales: List<TransactionEntity> = emptyList()) =
        Store(business, products.associateBy { it.id }.toMutableMap(), sales.associateBy { it.id }.toMutableMap())

    @Test fun thousandSalesAreBatchedAndAcknowledged() = runTest {
        val local = store(sales = List(1001) { sale(it) }); val remote = Remote(null)
        SyncEngine(local, remote).sync()
        assertEquals(listOf(0 to 400, 0 to 400, 0 to 201), remote.sizes)
        assertTrue(local.pendingTransactions().isEmpty())
        assertEquals(1001, remote.sales.size)
    }
    @Test fun allProductsPrecedeTheirSalesAndCanonicalIdIsAdopted() = runTest {
        val local = store(List(501) { product(it) }, List(501) { sale(it, "p$it") })
        val remote = Remote(business.copy(id = "server-business"))
        SyncEngine(local, remote).sync()
        assertEquals(listOf(400 to 0, 101 to 0, 0 to 400, 0 to 101), remote.sizes)
        assertEquals("server-business", local.current?.id)
        assertTrue(local.products.values.all { it.businessId == "server-business" })
        assertTrue(local.sales.values.all { it.businessId == "server-business" })
    }
    @Test fun interruptionResumesRemainingBatchesWithoutDuplicatingSales() = runTest {
        val local = store(sales = List(801) { sale(it) }); val remote = Remote(null)
        remote.failAt = 1
        try { SyncEngine(local, remote).sync(); fail("Expected network error") } catch (_: IllegalStateException) { }
        assertEquals(401, local.pendingTransactions().size)
        remote.failAt = -1
        SyncEngine(local, remote).sync()
        assertEquals(801, remote.sales.size)
        assertTrue(local.pendingTransactions().isEmpty())
    }
    @Test fun editsMadeDuringUploadRemainPending() = runTest {
        val local = store(sales = listOf(sale(0))); val remote = Remote(null)
        remote.afterUpload = { local.sales["t0"] = requireNotNull(local.sales["t0"]).copy(amount = 20, updatedAt = 101) }
        SyncEngine(local, remote).sync()
        assertEquals(20L, local.sales["t0"]?.amount)
        assertEquals(1, local.pendingTransactions().size)
    }
    @Test fun deletedProductsAreAcknowledgedWithoutDroppingSales() = runTest {
        val local = store(listOf(product(0).copy(deletedAt = 100)), listOf(sale(0, "p0"))); val remote = Remote(null)
        SyncEngine(local, remote).sync()
        assertEquals(100L, local.products["p0"]?.deletedAt)
        assertTrue(local.pendingProducts().isEmpty())
        assertEquals(1, local.sales.size)
    }
    @Test fun cleanInstallationDownloadsCanonicalBusiness() = runTest {
        val local = Store(null, mutableMapOf(), mutableMapOf()); val remote = Remote(business.copy(id = "server-business"))
        SyncEngine(local, remote).sync()
        assertEquals("server-business", local.current?.id)
    }
    @Test fun retryableHttpErrorsIncludeRateLimitsButValidationDoesNotRetry() {
        for (code in listOf(408, 429, 500, 503)) assertEquals(HttpDisposition.RETRY, httpDisposition(code))
        assertEquals(HttpDisposition.AUTH, httpDisposition(401))
        for (code in listOf(400, 403, 409)) assertEquals(HttpDisposition.REJECT, httpDisposition(code))
    }
}

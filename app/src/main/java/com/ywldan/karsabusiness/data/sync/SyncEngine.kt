package com.ywldan.karsabusiness.data.sync

import com.ywldan.karsabusiness.data.local.BusinessEntity
import com.ywldan.karsabusiness.data.local.ProductEntity
import com.ywldan.karsabusiness.data.local.TransactionEntity

// Below the server's 500-item limit for each array. Products precede their sales.
const val SYNC_BATCH_SIZE = 400

data class SyncSnapshot(
    val business: BusinessEntity?,
    val products: List<ProductEntity>,
    val transactions: List<TransactionEntity>,
)

interface SyncStore {
    suspend fun business(): BusinessEntity?
    suspend fun pendingProducts(): List<ProductEntity>
    suspend fun pendingTransactions(): List<TransactionEntity>
    suspend fun apply(snapshot: SyncSnapshot)
}

interface SyncRemote {
    suspend fun snapshot(): SyncSnapshot
    suspend fun upload(business: BusinessEntity, products: List<ProductEntity>, transactions: List<TransactionEntity>): SyncSnapshot
}

class SyncEngine(private val store: SyncStore, private val remote: SyncRemote) {
    suspend fun sync() {
        if (store.business() == null) {
            store.apply(remote.snapshot())
            if (store.business() == null) return
        }
        var uploaded = false
        for (batch in store.pendingProducts().chunked(SYNC_BATCH_SIZE)) {
            val business = requireNotNull(store.business())
            store.apply(remote.upload(business, batch.map { it.copy(businessId = business.id) }, emptyList()))
            uploaded = true
        }
        for (batch in store.pendingTransactions().chunked(SYNC_BATCH_SIZE)) {
            val business = requireNotNull(store.business())
            store.apply(remote.upload(business, emptyList(), batch.map { it.copy(businessId = business.id) }))
            uploaded = true
        }
        if (!uploaded) store.apply(remote.upload(requireNotNull(store.business()), emptyList(), emptyList()))
    }
}

enum class HttpDisposition { AUTH, RETRY, REJECT }
fun httpDisposition(code: Int): HttpDisposition = when {
    code == 401 -> HttpDisposition.AUTH
    code == 408 || code == 429 || code >= 500 -> HttpDisposition.RETRY
    else -> HttpDisposition.REJECT
}

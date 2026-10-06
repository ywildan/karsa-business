package com.ywldan.karsabusiness.data.sync

import com.ywldan.karsabusiness.data.local.BusinessEntity
import com.ywldan.karsabusiness.data.local.ProductEntity
import com.ywldan.karsabusiness.data.local.TransactionEntity
import com.ywldan.karsabusiness.data.local.SyncStatus

data class BusinessSnapshot(
    val businesses: List<BusinessEntity>,
    val products: List<ProductEntity>,
    val transactions: List<TransactionEntity>,
    val writableIds: Set<String>,
    val bootstrapId: String? = null,
)
interface MultiBusinessStore {
    suspend fun businesses(): List<BusinessEntity>
    suspend fun pendingProducts(): List<ProductEntity>
    suspend fun pendingTransactions(): List<TransactionEntity>
    suspend fun apply(snapshot: BusinessSnapshot)
}
interface MultiBusinessRemote {
    suspend fun snapshot(): BusinessSnapshot
    suspend fun upload(business: BusinessEntity, products: List<ProductEntity>, transactions: List<TransactionEntity>): BusinessSnapshot
}
class MultiBusinessSyncEngine(private val store: MultiBusinessStore, private val remote: MultiBusinessRemote) {
    suspend fun sync() {
        var cloud = remote.snapshot()
        store.apply(cloud)
        for (candidate in store.businesses()) {
            // An offline first business may not yet exist remotely. Extra businesses are created online.
            if (candidate.id !in cloud.writableIds && cloud.businesses.any { it.id == candidate.id }) continue
            var uploaded = false
            for (batch in store.pendingProducts().filter { it.businessId == candidate.id }.chunked(SYNC_BATCH_SIZE)) {
                val b = store.businesses().first { it.id == candidate.id }
                cloud = remote.upload(b, batch, emptyList()); store.apply(cloud); uploaded = true
            }
            for (batch in store.pendingTransactions().filter { it.businessId == candidate.id }.chunked(SYNC_BATCH_SIZE)) {
                val b = store.businesses().first { it.id == candidate.id }
                cloud = remote.upload(b, emptyList(), batch); store.apply(cloud); uploaded = true
            }
            if (!uploaded && candidate.syncStatus == SyncStatus.PENDING) {
                cloud = remote.upload(candidate, emptyList(), emptyList()); store.apply(cloud)
            }
        }
    }
}

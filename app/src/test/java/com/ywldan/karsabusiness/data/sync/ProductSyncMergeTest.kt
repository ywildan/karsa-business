package com.ywldan.karsabusiness.data.sync

import com.ywldan.karsabusiness.data.local.*
import org.junit.Assert.*
import org.junit.Test

class ProductSyncMergeTest {
    private val product = ProductEntity("p", "owner", "business", "Kopi", 100, 10, 100, 100)
    @Test fun initialDownloadDoesNotDiscardAPendingProductDeletion() {
        val local = product.copy(deletedAt = 101, updatedAt = 101)
        val server = product.copy(stock = 20, updatedAt = 110, syncStatus = SyncStatus.SYNCED)
        val merged = mergeSyncedProduct(local, server)
        assertEquals(101L, merged.deletedAt)
        assertEquals(20L, merged.stock)
        assertEquals(SyncStatus.PENDING, merged.syncStatus)
        val acknowledged = mergeSyncedProduct(merged, merged.copy(syncStatus = SyncStatus.SYNCED))
        assertEquals(SyncStatus.SYNCED, acknowledged.syncStatus)
        assertEquals(101L, acknowledged.deletedAt)
    }
    @Test fun olderServerDeletionCannotBeResurrectedByNewerOfflineStock() {
        val local = product.copy(stock = 30, updatedAt = 120)
        val server = product.copy(deletedAt = 110, updatedAt = 110, syncStatus = SyncStatus.SYNCED)
        val merged = mergeSyncedProduct(local, server)
        assertEquals(110L, merged.deletedAt)
        assertEquals(30L, merged.stock)
        assertEquals(SyncStatus.PENDING, merged.syncStatus)
    }
}

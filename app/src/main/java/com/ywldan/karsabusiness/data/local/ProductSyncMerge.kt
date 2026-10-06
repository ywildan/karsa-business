package com.ywldan.karsabusiness.data.local

/** A catalog deletion is retained even if another device made a newer stock edit. */
internal fun mergeSyncedProduct(local: ProductEntity?, incoming: ProductEntity): ProductEntity {
    if (local == null) return incoming
    val deletedAt = local.deletedAt ?: incoming.deletedAt
    return if (incoming.updatedAt >= local.updatedAt) {
        incoming.copy(
            deletedAt = deletedAt,
            syncStatus = if (local.deletedAt != null && incoming.deletedAt == null) SyncStatus.PENDING else incoming.syncStatus,
        )
    } else {
        local.copy(deletedAt = deletedAt)
    }
}

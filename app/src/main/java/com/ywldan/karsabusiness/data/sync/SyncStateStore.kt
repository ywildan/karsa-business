package com.ywldan.karsabusiness.data.sync

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow

// Persisted per account so a failed sync remains visible after restarting the app.
data class SyncState(val phase: String = "idle", val message: String = "", val lastSuccess: Long = 0)

class SyncStateStore(context: Context) {
    private val preferences = context.getSharedPreferences("karsa_sync_state", Context.MODE_PRIVATE)

    fun read(ownerId: String) = SyncState(
        preferences.getString("$ownerId.phase", "idle") ?: "idle",
        preferences.getString("$ownerId.message", "") ?: "",
        preferences.getLong("$ownerId.lastSuccess", 0),
    )

    fun write(ownerId: String, phase: String, message: String = "") {
        preferences.edit().putString("$ownerId.phase", phase).putString("$ownerId.message", message).apply {
            if (phase == "success") putLong("$ownerId.lastSuccess", System.currentTimeMillis())
        }.apply()
    }

    fun recoverInterruptedAttempts() {
        preferences.all.filter { (key, value) -> key.endsWith(".phase") && value == "running" }
            .keys.forEach { key ->
                write(key.removeSuffix(".phase"), "queued", "Sinkronisasi terputus. Data tetap tersimpan di perangkat; coba sinkronkan kembali.")
            }
    }

    fun observe(ownerId: String) = callbackFlow {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key?.startsWith("$ownerId.") == true) trySend(read(ownerId))
        }
        preferences.registerOnSharedPreferenceChangeListener(listener)
        trySend(read(ownerId))
        awaitClose { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }
}

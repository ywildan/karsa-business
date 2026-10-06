package com.ywldan.karsabusiness.data.sync

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow
import org.json.JSONObject

data class AccountState(val premiumUntil: Long = 0, val freeBusinessId: String? = null) {
    val premium: Boolean get() = premiumUntil > System.currentTimeMillis()
    val businessLimit: Int get() = if (premium) 5 else 1
}

class AccountStateStore(context: Context) {
    private val preferences = context.getSharedPreferences("karsa_account_state", Context.MODE_PRIVATE)
    fun read(ownerId: String) = AccountState(preferences.getLong("$ownerId.until", 0), preferences.getString("$ownerId.free", null))
    fun write(ownerId: String, value: JSONObject) {
        preferences.edit().putLong("$ownerId.until", if (value.isNull("premiumUntil")) 0 else value.optLong("premiumUntil"))
            .putString("$ownerId.free", if (value.isNull("freeBusinessId")) null else value.optString("freeBusinessId")).apply()
    }
    fun observe(ownerId: String) = callbackFlow {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key -> if (key?.startsWith("$ownerId.") == true) trySend(read(ownerId)) }
        preferences.registerOnSharedPreferenceChangeListener(listener)
        trySend(read(ownerId))
        awaitClose { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }
}

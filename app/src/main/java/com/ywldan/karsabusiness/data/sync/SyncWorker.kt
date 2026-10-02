package com.ywldan.karsabusiness.data.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.ywldan.karsabusiness.BuildConfig
import com.ywldan.karsabusiness.KarsaApplication
import com.ywldan.karsabusiness.data.local.BusinessEntity
import com.ywldan.karsabusiness.data.local.ProductEntity
import com.ywldan.karsabusiness.data.local.SyncStatus
import com.ywldan.karsabusiness.data.local.TransactionEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

class SyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        if (BuildConfig.API_BASE_URL.isBlank()) return@withContext Result.success()
        if (FirebaseApp.getApps(applicationContext).isEmpty()) return@withContext Result.success()
        val firebaseUser = FirebaseAuth.getInstance().currentUser ?: return@withContext Result.success()
        val token = firebaseUser.getIdToken(false).await().token ?: return@withContext Result.retry()
        val dao = (applicationContext as KarsaApplication).database.karsaDao()
        val business = dao.getBusiness(firebaseUser.uid)
        val pending = dao.getPendingTransactions(firebaseUser.uid)
        val pendingProducts = dao.getPendingProducts(firebaseUser.uid)

        try {
            val endpoint = if (business == null) "/v1/snapshot" else "/v1/sync"
            val connection = (URL(BuildConfig.API_BASE_URL.trimEnd('/') + endpoint)
                .openConnection() as HttpURLConnection).apply {
                requestMethod = if (business == null) "GET" else "POST"
                connectTimeout = 15_000
                readTimeout = 20_000
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("Content-Type", "application/json")
            }
            if (business != null) {
                connection.doOutput = true
                val payload = JSONObject()
                    .put("business", business.toJson())
                    .put("transactions", JSONArray().apply { pending.forEach { put(it.toJson()) } })
                    .put("products", JSONArray().apply { pendingProducts.forEach { put(it.toJson()) } })
                connection.outputStream.bufferedWriter().use { it.write(payload.toString()) }
            }
            if (connection.responseCode !in 200..299) {
                return@withContext if (connection.responseCode >= 500) Result.retry() else Result.failure()
            }
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val response = JSONObject(body)
            response.optJSONObject("business")?.let {
                dao.replaceBusiness(it.toBusiness(firebaseUser.uid))
            }
            val rows = response.optJSONArray("transactions") ?: JSONArray()
            val remote = buildList {
                for (index in 0 until rows.length()) add(rows.getJSONObject(index).toEntity(firebaseUser.uid))
            }
            if (remote.isNotEmpty()) dao.syncTransactions(remote)
            val productRows = response.optJSONArray("products") ?: JSONArray()
            val remoteProducts = buildList {
                for (index in 0 until productRows.length()) {
                    add(productRows.getJSONObject(index).toProduct(firebaseUser.uid))
                }
            }
            if (remoteProducts.isNotEmpty()) dao.syncProducts(remoteProducts)
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}

object SyncScheduler {
    private val connected = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    fun enqueue(context: Context) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(connected)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            "karsa-sync-now",
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    fun schedulePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(6, TimeUnit.HOURS)
            .setConstraints(connected)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "karsa-sync-periodic",
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }
}

private fun BusinessEntity.toJson() = JSONObject()
    .put("id", id)
    .put("name", name)
    .put("type", type)
    .put("initialCapital", initialCapital)
    .put("createdAt", createdAt)
    .put("updatedAt", updatedAt)

private fun TransactionEntity.toJson() = JSONObject()
    .put("id", id)
    .put("businessId", businessId)
    .put("type", type)
    .put("amount", amount)
    .put("category", category)
    .put("paymentMethod", paymentMethod)
    .put("note", note)
    .put("transactionDate", transactionDate)
    .put("createdAt", createdAt)
    .put("updatedAt", updatedAt)
    .put("deletedAt", deletedAt ?: JSONObject.NULL)
    .put("productId", productId ?: JSONObject.NULL)
    .put("quantity", quantity ?: JSONObject.NULL)

private fun ProductEntity.toJson() = JSONObject()
    .put("id", id)
    .put("businessId", businessId)
    .put("name", name)
    .put("price", price)
    .put("stock", stock)
    .put("createdAt", createdAt)
    .put("updatedAt", updatedAt)
    .put("deletedAt", deletedAt ?: JSONObject.NULL)

private fun JSONObject.toEntity(ownerId: String) = TransactionEntity(
    id = getString("id"),
    ownerId = ownerId,
    businessId = getString("businessId"),
    type = getString("type"),
    amount = getLong("amount"),
    category = getString("category"),
    paymentMethod = getString("paymentMethod"),
    note = optString("note"),
    transactionDate = getLong("transactionDate"),
    createdAt = getLong("createdAt"),
    updatedAt = getLong("updatedAt"),
    deletedAt = if (isNull("deletedAt")) null else getLong("deletedAt"),
    syncStatus = SyncStatus.SYNCED,
    productId = if (isNull("productId")) null else getString("productId"),
    quantity = if (isNull("quantity")) null else getLong("quantity"),
)

private fun JSONObject.toProduct(ownerId: String) = ProductEntity(
    id = getString("id"),
    ownerId = ownerId,
    businessId = getString("businessId"),
    name = getString("name"),
    price = getLong("price"),
    stock = getLong("stock"),
    createdAt = getLong("createdAt"),
    updatedAt = getLong("updatedAt"),
    deletedAt = if (isNull("deletedAt")) null else getLong("deletedAt"),
    syncStatus = SyncStatus.SYNCED,
)

private fun JSONObject.toBusiness(ownerId: String) = BusinessEntity(
    id = getString("id"),
    ownerId = ownerId,
    name = getString("name"),
    type = getString("type"),
    initialCapital = getLong("initialCapital"),
    createdAt = getLong("createdAt"),
    updatedAt = getLong("updatedAt"),
    syncStatus = SyncStatus.SYNCED,
)

package com.ywldan.karsabusiness.data.sync

import android.content.Context
import android.util.Log
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
        syncMutex.withLock {
            if (FirebaseApp.getApps(applicationContext).isEmpty()) return@withLock Result.success()
            val auth = FirebaseAuth.getInstance()
            val user = auth.currentUser ?: return@withLock Result.success()
            val ownerId = user.uid
            val status = SyncStateStore(applicationContext)
            val dao = (applicationContext as KarsaApplication).database.karsaDao()
            try {
                if (BuildConfig.API_BASE_URL.isBlank()) {
                    status.write(ownerId, "failed", "Sinkronisasi belum dikonfigurasi. Hubungi pengelola aplikasi.")
                    return@withLock Result.failure()
                }
                status.write(ownerId, "running")
                var token = user.getIdToken(false).await().token ?: error("Token unavailable")
                suspend fun checkAccount() {
                    currentCoroutineContext().ensureActive()
                    if (auth.currentUser?.uid != ownerId) throw CancellationException("Account changed")
                }
                suspend fun request(payload: JSONObject?): SyncSnapshot {
                    checkAccount()
                    suspend fun send(): JSONObject {
                        val connection = (URL(BuildConfig.API_BASE_URL.trimEnd('/') +
                            if (payload == null) "/v1/snapshot" else "/v1/sync").openConnection() as HttpURLConnection).apply {
                            requestMethod = if (payload == null) "GET" else "POST"
                            instanceFollowRedirects = false
                            connectTimeout = 15_000
                            readTimeout = 20_000
                            setRequestProperty("Authorization", "Bearer $token")
                            setRequestProperty("Content-Type", "application/json")
                        }
                        try {
                            if (payload != null) {
                                connection.doOutput = true
                                connection.outputStream.bufferedWriter().use { it.write(payload.toString()) }
                            }
                            if (connection.responseCode !in 200..299) throw SyncHttpException(connection.responseCode)
                            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                        } finally { connection.disconnect() }
                    }
                    val body = try { send() } catch (error: SyncHttpException) {
                        if (error.status != 401) throw error
                        token = user.getIdToken(true).await().token ?: throw error
                        checkAccount()
                        send()
                    }
                    checkAccount()
                    val rows = body.getJSONArray("transactions")
                    val products = body.getJSONArray("products")
                    return SyncSnapshot(
                        body.optJSONObject("business")?.toBusiness(ownerId),
                        List(products.length()) { products.getJSONObject(it).toProduct(ownerId) },
                        List(rows.length()) { rows.getJSONObject(it).toEntity(ownerId) },
                    )
                }
                val store = object : SyncStore {
                    override suspend fun business() = dao.getBusiness(ownerId)
                    override suspend fun pendingProducts() = dao.getPendingProducts(ownerId)
                    override suspend fun pendingTransactions() = dao.getPendingTransactions(ownerId)
                    override suspend fun apply(snapshot: SyncSnapshot) {
                        checkAccount()
                        dao.applySnapshot(snapshot.business, snapshot.products, snapshot.transactions)
                    }
                }
                val remote = object : SyncRemote {
                    override suspend fun snapshot() = request(null)
                    override suspend fun upload(business: BusinessEntity, products: List<ProductEntity>, transactions: List<TransactionEntity>) =
                        request(JSONObject().put("business", business.toJson())
                            .put("products", JSONArray().apply { products.forEach { put(it.toJson()) } })
                            .put("transactions", JSONArray().apply { transactions.forEach { put(it.toJson()) } }))
                }
                SyncEngine(store, remote).sync()
                status.write(ownerId, "success")
                Result.success()
            } catch (cancelled: CancellationException) {
                status.write(ownerId, "queued", "Sinkronisasi belum selesai. Data tetap tersimpan di perangkat.")
                throw cancelled
            } catch (error: SyncHttpException) {
                Log.w("KarsaSync", "Sync HTTP ${error.status}")
                when (httpDisposition(error.status)) {
                    HttpDisposition.RETRY -> {
                        status.write(ownerId, "retry", "Server belum dapat dihubungi. Akan dicoba kembali; data tersimpan di perangkat.")
                        Result.retry()
                    }
                    HttpDisposition.AUTH -> {
                        status.write(ownerId, "failed", "Sesi tidak diterima server. Keluar dan masuk kembali untuk melanjutkan sinkronisasi.")
                        Result.failure()
                    }
                    HttpDisposition.REJECT -> {
                        status.write(ownerId, "failed", "Data belum dapat disinkronkan. Coba lagi; jika tetap gagal, hubungi pengelola aplikasi.")
                        Result.failure()
                    }
                }
            } catch (error: org.json.JSONException) {
                Log.w("KarsaSync", "Invalid sync response: ${error.javaClass.simpleName}")
                status.write(ownerId, "failed", "Respons server tidak sesuai. Data tetap tersimpan di perangkat; coba lagi setelah server diperbaiki.")
                Result.failure()
            } catch (error: Exception) {
                Log.w("KarsaSync", "Sync interrupted: ${error.javaClass.simpleName}")
                status.write(ownerId, "retry", "Sinkronisasi tertunda. Periksa koneksi internet; data tetap tersimpan di perangkat.")
                Result.retry()
            }
        }
    }

    companion object { private val syncMutex = Mutex() }
}

private class SyncHttpException(val status: Int) : Exception("HTTP $status")

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

package com.ywldan.karsabusiness.data.sync

import com.google.firebase.auth.FirebaseAuth
import com.ywldan.karsabusiness.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Uses the same Firebase identity as Android; all limits are checked by the API. */
object BusinessCloud {
    suspend fun request(path: String, payload: JSONObject, method: String = "POST"): JSONObject = withContext(Dispatchers.IO) {
        check(BuildConfig.API_BASE_URL.isNotBlank()) { "Server belum dikonfigurasi" }
        val auth = FirebaseAuth.getInstance()
        val user = auth.currentUser ?: error("Masuk kembali untuk mengelola bisnis")
        suspend fun send(force: Boolean): Pair<Int, String> {
            val token = user.getIdToken(force).await().token ?: error("Sesi tidak tersedia")
            check(auth.currentUser?.uid == user.uid) { "Akun berubah. Coba kembali." }
            val connection = (URL(BuildConfig.API_BASE_URL.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                instanceFollowRedirects = false
                connectTimeout = 15_000
                readTimeout = 20_000
                doOutput = true
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("Content-Type", "application/json")
            }
            try {
                connection.outputStream.bufferedWriter().use { it.write(payload.toString()) }
                val code = connection.responseCode
                val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                return code to (stream?.bufferedReader()?.use { it.readText() } ?: "{}")
            } finally { connection.disconnect() }
        }
        var result = send(false)
        if (result.first == 401) result = send(true)
        check(auth.currentUser?.uid == user.uid) { "Akun berubah. Coba kembali." }
        val body = JSONObject(result.second)
        check(result.first in 200..299) { body.optString("error", "Tidak dapat menghubungi server") }
        body
    }
}

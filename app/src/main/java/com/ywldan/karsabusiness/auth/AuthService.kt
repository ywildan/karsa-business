package com.ywldan.karsabusiness.auth

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import com.ywldan.karsabusiness.BuildConfig
import com.ywldan.karsabusiness.domain.isAllowedCampusEmail
import kotlinx.coroutines.tasks.await

data class AuthUser(
    val id: String,
    val email: String,
    val name: String,
    val isLocalDemo: Boolean = false,
)

class AuthService(private val activity: Activity) {
    val isConfigured: Boolean
        get() = FirebaseApp.getApps(activity).isNotEmpty()

    fun currentUser(): AuthUser? {
        if (!isConfigured) return null
        val user = FirebaseAuth.getInstance().currentUser ?: return null
        val email = user.email.orEmpty()
        if (!user.isEmailVerified || !isAllowedCampusEmail(email)) return null
        return AuthUser(user.uid, email, user.displayName ?: email.substringBefore('@'))
    }

    suspend fun signIn(email: String, password: String): AuthUser {
        requireConfigured()
        require(isAllowedCampusEmail(email)) { "Gunakan email @students.untidar.ac.id" }
        val result = FirebaseAuth.getInstance()
            .signInWithEmailAndPassword(email.trim(), password)
            .await()
        val user = requireNotNull(result.user)
        if (!user.isEmailVerified) {
            user.sendEmailVerification().await()
            FirebaseAuth.getInstance().signOut()
            error("Email belum diverifikasi. Tautan verifikasi telah dikirim ulang.")
        }
        return AuthUser(user.uid, user.email.orEmpty(), user.displayName ?: email.substringBefore('@'))
    }

    suspend fun register(name: String, email: String, password: String) {
        requireConfigured()
        require(name.trim().length >= 2) { "Nama minimal 2 karakter" }
        require(isAllowedCampusEmail(email)) { "Gunakan email @students.untidar.ac.id" }
        require(password.length >= 8) { "Kata sandi minimal 8 karakter" }
        val result = FirebaseAuth.getInstance()
            .createUserWithEmailAndPassword(email.trim(), password)
            .await()
        val user = requireNotNull(result.user)
        user.updateProfile(
            com.google.firebase.auth.UserProfileChangeRequest.Builder()
                .setDisplayName(name.trim())
                .build(),
        ).await()
        user.sendEmailVerification().await()
        FirebaseAuth.getInstance().signOut()
    }

    suspend fun signInWithGoogle(): AuthUser {
        requireConfigured()
        check(BuildConfig.FIREBASE_WEB_CLIENT_ID.isNotBlank()) {
            "FIREBASE_WEB_CLIENT_ID belum dikonfigurasi"
        }
        val googleOption = GetGoogleIdOption.Builder()
            .setServerClientId(BuildConfig.FIREBASE_WEB_CLIENT_ID)
            .setFilterByAuthorizedAccounts(false)
            .build()
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleOption)
            .build()
        val result = CredentialManager.create(activity).getCredential(activity, request)
        val custom = result.credential as? CustomCredential
            ?: error("Kredensial Google tidak dikenali")
        check(custom.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            "Kredensial Google tidak dikenali"
        }
        val google = GoogleIdTokenCredential.createFrom(custom.data)
        val credential = GoogleAuthProvider.getCredential(google.idToken, null)
        val firebase = FirebaseAuth.getInstance().signInWithCredential(credential).await().user
            ?: error("Google Sign-In gagal")
        val email = firebase.email.orEmpty()
        if (!isAllowedCampusEmail(email)) {
            FirebaseAuth.getInstance().signOut()
            error("Akun Google harus memakai email @students.untidar.ac.id")
        }
        return AuthUser(firebase.uid, email, firebase.displayName ?: email.substringBefore('@'))
    }

    fun signOut() {
        if (isConfigured) FirebaseAuth.getInstance().signOut()
    }

    private fun requireConfigured() {
        check(isConfigured) { "Firebase belum dikonfigurasi untuk build ini" }
    }
}


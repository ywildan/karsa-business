# Aturan R8 untuk build release (minify + shrinkResources aktif).
#
# Build release adalah build yang benar-benar dipakai pengguna, jadi kelas yang
# di-resolve lewat reflection (Room, WorkManager, AndroidX Credentials) WAJIB
# dipertahankan. Build debug tidak memakai aturan ini, sehingga masalah R8 baru
# muncul saat rilis - pastikan Google Sign-In, sinkronisasi WorkManager, dan
# opening database Room sudah diuji sebelum rilis dikirim ke pengguna.

# --- Atribut bytecode ---------------------------------------------------
# Credential/Identity/Firebase membaca annotation dan signature lewat reflection.
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes InnerClasses,EnclosingMethod
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations
-keepattributes RuntimeVisibleTypeAnnotations,AnnotationDefault

# --- Room ---------------------------------------------------------------
# Room membangun implementasi DAO saat runtime berdasarkan nama class.
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep @androidx.room.Database class * { *; }
-keep @androidx.room.Entity class * { *; }
-keep @androidx.room.Dao interface * { *; }

# --- WorkManager --------------------------------------------------------
# Worker di-resolve dari nama class yang tersimpan di Room. Nama class wajib
# stabil dan konstruktor (Context, WorkerParameters) wajib ada setelah minify,
# kalau tidak pekerjaan terjadwal akan gagal diam-diam setelah update aplikasi.
-keep class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
-keep class com.ywldan.karsabusiness.data.sync.SyncWorker { *; }

# --- AndroidX Credentials + Google Identity (Google Sign-In) -----------
# CredentialState dan pemetaan tipe credential memakai reflection/@Parcelize.
-keep class androidx.credentials.** { *; }
-keep class androidx.credentials.plservices.** { *; }
-keep class com.google.android.libraries.identity.googleid.** { *; }
-keep class com.google.android.gms.auth.api.identity.** { *; }
-keep class com.google.android.gms.common.api.** { *; }
-keep class com.google.android.gms.tasks.** { *; }
-keep interface com.google.android.gms.tasks.** { *; }

# --- Firebase -----------------------------------------------------------
# Ditahankan penuh seperti sebelumnya: Firebase Auth dan pemeriksa sesi
# membaca banyak member via reflection.
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# --- Enum ---------------------------------------------------------------
# Nilai enum dibaca lewat reflection oleh Room dan lapisan sinkronisasi.
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# --- Coroutines / konscrypt --------------------------------------------
# Aturan asli sudah dibawa kotlinx-coroutines-play-services; cukup tekan warning
# untuk kelas opsional yang tidak ada di semua konfigurasi perangkat.
-dontwarn kotlinx.coroutines.**
-dontwarn org.conscrypt.**
-dontwarn javax.annotation.**
-dontwarn sun.misc.**
-dontwarn org.codehaus.mojo.animal_sniffer.**

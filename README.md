# Karsa Business

Karsa Business adalah aplikasi Android native untuk pencatatan keuangan bisnis mahasiswa. UI dibangun dengan Kotlin dan Jetpack Compose, penyimpanan lokal memakai Room, sinkronisasi memakai WorkManager, autentikasi memakai Firebase Auth, dan data cloud disimpan di Neon PostgreSQL melalui Neon Functions.

## Fitur MVP

- Onboarding dan setup satu bisnis per akun.
- Masuk/daftar melalui email mahasiswa atau Google.
- Pembatasan email `@students.untidar.ac.id` di aplikasi dan backend.
- Pencatatan pemasukan/pengeluaran secara offline.
- Edit dan soft delete transaksi.
- Riwayat, pencarian, filter, saldo, serta laporan bulanan.
- Sinkronisasi otomatis dan dukungan beberapa perangkat.
- APK debug dan release dibangun sepenuhnya oleh GitHub Actions.

## Arsitektur

```text
Android (Compose)
  ├─ Room: sumber data lokal
  ├─ WorkManager: antrean sinkronisasi
  ├─ Firebase Auth: identitas pengguna
  └─ Neon Function API
       └─ Neon PostgreSQL
```

Connection string Neon tidak pernah dimasukkan ke APK. Aplikasi hanya mengenal URL HTTPS API dan token Firebase pengguna.

## GitHub Secrets

Tambahkan melalui **Repository Settings → Secrets and variables → Actions**:

| Secret | Kegunaan |
|---|---|
| `FIREBASE_API_KEY` | API key aplikasi Android Firebase |
| `FIREBASE_APP_ID` | Firebase Android App ID |
| `FIREBASE_PROJECT_ID` | ID project Firebase |
| `FIREBASE_WEB_CLIENT_ID` | OAuth Web Client ID untuk Google Sign-In |
| `KARSA_API_BASE_URL` | URL publik Neon Function tanpa garis miring terakhir |
| `DATABASE_URL` | Pooled connection string Neon, hanya untuk backend workflow |
| `NEON_API_KEY` | Project-scoped Neon API key |
| `NEON_PROJECT_ID` | ID project Neon |
| `ANDROID_KEYSTORE_BASE64` | Keystore release dalam format base64 |
| `ANDROID_KEYSTORE_PASSWORD` | Password keystore |
| `ANDROID_KEY_ALIAS` | Alias signing key |
| `ANDROID_KEY_PASSWORD` | Password signing key |

## Firebase

1. Buat aplikasi Android dengan package `com.ywldan.karsabusiness`.
2. Aktifkan Email/Password dan Google pada Firebase Authentication.
3. Tambahkan SHA-1 dan SHA-256 dari release keystore ke aplikasi Firebase.
4. Ambil nilai konfigurasi dari halaman pengaturan project dan simpan sebagai GitHub Secrets.

Build debug memakai package `com.ywldan.karsabusiness.debug`. Tambahkan aplikasi Android kedua di Firebase jika Google Sign-In juga perlu diuji pada APK debug.

## Backend Neon

Workflow **Deploy Neon Backend** dijalankan manual setelah secrets Neon tersedia. Workflow tersebut:

1. menyuntikkan Firebase Project ID publik ke bundle backend;
2. memeriksa TypeScript;
3. menerapkan migration PostgreSQL;
4. menautkan project Neon;
5. men-deploy Neon Function.

Setelah deployment pertama, salin URL Function ke secret `KARSA_API_BASE_URL` lalu jalankan ulang Android CI.

## Build dan release

- Setiap push/PR ke `main` menjalankan unit test dan menghasilkan artifact APK debug.
- Push tag seperti `v0.1.0` menjalankan test, membuat APK release bertanda tangan, lalu mengunggahnya ke GitHub Releases.
- Workflow release juga bisa dijalankan manual dari tab Actions.

Keystore release harus disimpan permanen dan dicadangkan. APK versi berikutnya tidak dapat memperbarui aplikasi yang sudah terpasang jika ditandatangani dengan key berbeda.

## Catatan keamanan

- Pembatasan domain dan kepemilikan satu bisnis diterapkan kembali oleh backend.
- Firebase ID token diverifikasi menggunakan JWKS resmi Google.
- Semua query backend menggunakan parameter SQL.
- Penghapusan transaksi menggunakan `deleted_at` agar tersinkronkan ke perangkat lain.

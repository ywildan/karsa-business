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

## Penandatanganan rilis dan pembaruan aplikasi

Pengguna bisa memasang APK baru **di atas** aplikasi lama tanpa kehilangan data,
hanya bila tiga syarat berikut sekaligus terpenuhi:

| Syarat | Penanggung jawab |
|---|---|
| `applicationId` sama persis | `com.ywldan.karsabusiness` di `app/build.gradle.kts` |
| Ditandatangani sertifikat yang sama | Keystore release yang dipakai ulang tiap rilis |
| `versionCode` tidak lebih kecil | Diturunkan dari nama versi pada tag rilis |

Build `debug` memakai `com.ywldan.karsabusiness.debug`, jadi APK debug bisa
berdampingan dan tidak pernah menimpa APK rilis.

### Fingerprint sertifikat

File `release-cert.sha256` di root repository berisi fingerprint SHA-256
sertifikat signing release (64 karakter heksadesimal tanpa tanda titik dua).
Workflow **Android Release** membandingkannya dengan sertifikat yang benar-benar
dipakai untuk menandatangani APK dan **membatalkan rilis** bila tidak cocok. Ini
yang mencegah keystore terganti diam-diam: tanpa pemeriksaan tersebut semua
aplikasi terpasang akan gagal update (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) dan
pengguna dipaksa uninstall, yang berarti seluruh data Room ikut hilang.

Isi file tersebut sekali saja saat keystore pertama dibuat:

```bash
keytool -list -v -keystore karsa-release.jks -alias <alias> | grep SHA256
```

Salin nilai yang muncul (tanpa `:`) ke `release-cert.sha256`, lalu commit.
Nilai yang sama juga perlu didaftarkan di Firebase sebagai **SHA-256 signing
certificate** agar Google Sign-In tetap berfungsi.

### Guard rilis

Sebelum build, workflow menolak rilis yang:

- tag-nya bukan `vMAJOR.MINOR.PATCH`;
- `versionCode`-nya lebih kecil dari rilis terakhir (mencegah `INSTALL_FAILED_VERSION_DOWNGRADE`);
- konfigurasi Firebase/API kosong atau berupa placeholder `CI_PLACEHOLDER_*`;
- keystore gagal dibuka oleh `keytool` memakai password/alias yang diberikan.

Setelah build, `apksigner verify` memastikan APK benar-benar bertanda tangan dan
sertifikatnya cocok dengan keystore. Rilis dengan nomor versi yang **sama**
tetap diizinkan, sehingga APK yang gagal dibangun ulang bisa diunggah ulang.

### Cadangan keystore

Keystore release adalah identitas aplikasi dan **tidak bisa dibuat ulang**.
Kalau hilang, tidak ada versi berikutnya yang bisa memperbarui aplikasi yang
sudah terpasang. Simpan minimal dua salinan di tempat terpisah dan catat
password/alias di password manager.

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
- Push tag seperti `v1.0.2` menjalankan test, membuat APK release bertanda tangan, lalu mengunggahnya ke GitHub Releases.
- Workflow release juga bisa dijalankan manual dari tab Actions. Field versi **wajib diisi** dan harus lebih besar dari rilis terakhir, misalnya `v1.0.2` setelah `v1.0.1`; kolomnya sengaja tidak lagi punya nilai bawaan agar versi lama tidak ikut terpakai.
- Saat dijalankan manual, nomor versi dibandingkan dengan GitHub Release terakhir, bukan hanya dengan tag di repository.

Detail syarat pembaruan aplikasi danCadangan keystore ada di bagian
[Penandatanganan rilis](#penandatanganan-rilis-dan-pembaruan-aplikasi).

## Catatan keamanan

- Pembatasan domain dan kepemilikan satu bisnis diterapkan kembali oleh backend.
- Firebase ID token diverifikasi menggunakan JWKS resmi Google.
- Semua query backend menggunakan parameter SQL.
- Penghapusan transaksi menggunakan `deleted_at` agar tersinkronkan ke perangkat lain.

# Karsa Business

Karsa Business adalah aplikasi Android native untuk pencatatan keuangan bisnis mahasiswa. UI dibangun dengan Kotlin dan Jetpack Compose, penyimpanan lokal memakai Room, sinkronisasi memakai WorkManager, autentikasi memakai Firebase Auth, dan data cloud disimpan di Neon PostgreSQL melalui API pada Vercel atau Neon Functions. Dashboard web Premium berada di `backend/public` dan memakai API serta akun yang sama dengan HP.

## Fitur MVP

- Onboarding dan setup bisnis: Gratis satu bisnis aktif, Premium maksimal lima bisnis.
- Masuk/daftar melalui email mahasiswa atau Google.
- Pembatasan email `@students.untidar.ac.id` di aplikasi dan backend.
- Pencatatan pemasukan/pengeluaran secara offline.
- Edit dan soft delete transaksi.
- Riwayat, pencarian, filter, saldo, serta laporan bulanan.
- Sinkronisasi otomatis, dukungan beberapa perangkat, dan isolasi data per bisnis.
- Dashboard web Premium untuk transaksi, produk/stok, analitik enam bulan, CSV, dan cetak PDF.
- APK debug dan release dibangun sepenuhnya oleh GitHub Actions.

## Arsitektur

```text
Android (Compose)
  ├─ Room: sumber data lokal
  ├─ WorkManager: antrean sinkronisasi
  ├─ Firebase Auth: identitas pengguna
  └─ API (Vercel / Neon Function)
       └─ Neon PostgreSQL
```

Connection string Neon tidak pernah dimasukkan ke APK. Aplikasi hanya mengenal URL HTTPS API dan token Firebase pengguna.

## Dashboard web Premium dan Vercel

Panduan lengkap aktivasi Premium manual, migrasi tanpa kehilangan bisnis lama, Firebase web, environment variables Vercel, dan penerbitan APK baru ada di [docs/PREMIUM-DEPLOYMENT.md](docs/PREMIUM-DEPLOYMENT.md). Root Directory Vercel adalah `backend`. Pembayaran otomatis belum diintegrasikan.

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
sertifikat signing release (64 karakter heksadesimal; pemisah titik dua juga diterima).
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
- `versionCode`-nya tidak lebih tinggi dari seluruh rilis, termasuk draft/prerelease (mencegah `INSTALL_FAILED_VERSION_DOWNGRADE`);
- konfigurasi Firebase/API kosong atau berupa placeholder `CI_PLACEHOLDER_*`;
- keystore gagal dibuka oleh `keytool` memakai password/alias yang diberikan.

Setelah build, `apksigner verify` memastikan APK benar-benar bertanda tangan dan
sertifikatnya cocok dengan keystore. Versi yang sudah diterbitkan tidak boleh ditimpa.
Setiap pembaruan membutuhkan nomor versi baru. Komponen versi harus 0..999 dan
formatnya tepat `MAJOR.MINOR.PATCH`. APK disertai `SHA256SUMS`; tag manual menunjuk
commit yang benar-benar dibangun.

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
3. menerapkan seluruh migration PostgreSQL secara berurutan, memakai ledger checksum dan transaksi;
4. menautkan project Neon secara noninteraktif ke branch yang dipilih;
5. men-deploy Neon Function.

Secret `DATABASE_URL` harus berasal dari branch Neon yang sama dengan target deploy.
Atur repository variable `NEON_BRANCH` untuk memilih nama/ID branch secara eksplisit;
jika kosong, CLI memilih branch default project. Deployment hanya berjalan dari `main`.
Dependency backend dikunci dengan lockfile dan dipasang melalui `npm ci`.
Migration lama yang sudah diterapkan tidak boleh diedit; tambahkan berkas migration baru.

Setelah deployment pertama, salin URL Function ke secret `KARSA_API_BASE_URL` lalu jalankan ulang Android CI.

## Build dan release

- Setiap push/PR ke `main` menjalankan unit test, membangun APK debug, dan menguji build release dengan R8 serta keystore/config uji. Artifact yang dibagikan CI tetap APK debug.
- Push tag seperti `v1.0.2` menjalankan test, membuat APK release bertanda tangan, lalu mengunggahnya ke GitHub Releases.
- Untuk publish versi baru otomatis, buka **Actions → Android Release → Run workflow** pada `main`, lalu centang **publish_release**. Workflow memilih versi berikutnya di atas seluruh GitHub Releases (termasuk draft/prerelease) dan tag yang sudah ada, membangun APK bertanda tangan, lalu membuat GitHub Release beserta checksum. Rilis pertama memakai `v0.1.0`; contoh setelah `v1.0.3` akan dipilih `v1.0.4`.
- Tanpa centang **publish_release**, workflow hanya menjalankan Android CI untuk validasi dan tidak menerbitkan rilis. Tidak ada kolom versi manual; nomor versi selalu dipilih otomatis ketika publish dari Actions. Jika `main` berubah selama build, jalankan kembali workflow dari commit terbaru.
- Saat dijalankan manual, nomor versi dibandingkan dengan semua halaman GitHub Releases, termasuk draft/prerelease. Versi sama dan downgrade ditolak.

Detail syarat pembaruan aplikasi danCadangan keystore ada di bagian
[Penandatanganan rilis](#penandatanganan-rilis-dan-pembaruan-aplikasi).

## Catatan keamanan

- Pembatasan domain dan kepemilikan satu bisnis diterapkan kembali oleh backend.
- Firebase ID token diverifikasi menggunakan JWKS resmi Google.
- Semua query backend menggunakan parameter SQL.
- Penghapusan transaksi menggunakan `deleted_at` agar tersinkronkan ke perangkat lain.

## Perbaikan sinkronisasi dan verifikasi

Pengiriman dibatasi 400 produk/transaksi per batch, dengan produk dikirim sebelum
penjualannya. Produk terhapus dikirim sebagai tombstone agar penghapusan menyebar,
sementara penjualan lama tetap dapat disinkronkan. Perubahan stok offline tidak menghidupkan kembali produk yang sudah dihapus. Usaha yang dibuat offline di
perangkat kedua dihubungkan ke ID usaha kanonik milik akun yang sama; hubungan
produk dan transaksi lokal ikut diperbarui. Perubahan lokal yang lebih baru tetap
pending ketika respons upload yang lebih lama tiba.

Banner dan halaman Profil menampilkan perubahan pending, kegagalan, serta waktu
sinkronisasi terakhir berhasil. Gangguan jaringan/server dan HTTP 408/429 dicoba
ulang; validasi dan respons server yang rusak memerlukan tindakan pengguna.
HTTP 401 mencoba pembaruan token sekali sebelum meminta pengguna masuk kembali.
Status kegagalan tidak menyimpan token maupun isi transaksi.

Urutan penerapan: gabungkan perbaikan, deploy backend dari `main`, uji sinkronisasi,
lalu terbitkan APK dengan versi yang lebih tinggi (berikutnya `v1.0.3` setelah `v1.0.2`).
Keystore dan konfigurasi Firebase produksi tetap harus sesuai aplikasi terpasang.

Checklist HP:

- Update di atas v1.0.2 tanpa uninstall; usaha, produk, dan riwayat tetap ada.
- Buat data offline, sambungkan kembali, dan periksa status pending hingga selesai.
- Uji lebih dari 500 transaksi/produk; putuskan koneksi di tengah sinkronisasi lalu lanjutkan.
- Pada dua perangkat dengan akun sama, hapus produk di A dan sinkronkan penjualan lama di B.
- Buat usaha offline di perangkat kedua, lalu sinkronkan; periksa ID usaha, produk, dan transaksi.
- Edit data ketika sinkronisasi berlangsung; perubahan baru tidak boleh tertimpa respons lama.
- Coba hapus transaksi dan periksa pengembalian stok serta riwayat.
- Uji login Google, keluar/masuk akun berbeda, dan tampilan pada tablet/foldable.

Pengujian lokal menggunakan `./gradlew testDebugUnitTest assembleDebug`; build rilis
memerlukan konfigurasi Firebase/API dan signing yang valid. Backend:
`npm ci`, `npm run check`, dan `TEST_DATABASE_URL=<database-uji> npm test` dari `backend`.
Database pengujian memakai schema terpisah yang dibuat/dihapus otomatis. Guard rilis:
`python3 -m unittest discover -s tests` dari root.

Konflik perubahan stok antarperangkat tetap memakai `updatedAt` terbaru. Sertakan perubahan stok bersamaan dalam pengujian dua HP.

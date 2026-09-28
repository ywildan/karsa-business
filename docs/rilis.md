# Rilis Karsa Business

Dokumen ini ada karena satu fakta: tidak ada Flutter, Dart, Java, keytool, atau
Android SDK di mesin pengembang. Yang membangun APK hanyalah GitHub Actions, dan
yang menyimpan kunci privat hanyalah kamu. Jadi sebagian langkah ini sengaja
ditulis untuk dikerjakan orang, bukan agen.

## Kunci release dibuat sekali, di Codespaces

Karsa Business memakai **keystore sendiri** — bukan kunci Karsa atau Campus.
Satu kunci yang bocor menandatangani semua produk yang membagikannya, dan
kunci untuk aplikasi pembukuan yang menyimpan catatan orang lain tidak boleh
menanggung risiko itu.

1. Buka repo `ywildan/karsa-business`, buat Codespace sementara, buka terminalnya.
2. `keytool -help` — kalau belum ada, pasang JDK di Codespace saja:
   `sudo apt-get install -y openjdk-17-jdk-headless`.
3. Buat keystore sekali:

   ```sh
   keytool -genkeypair -v -keystore kb-release.jks -storetype JKS \
     -alias kb-release -keyalg RSA -keysize 4096 -validity 10000 \
     -dname "CN=Karsa Business, OU=Apps, O=Ywildan, L=Semarang, ST=Jawa Tengah, C=ID"
   ```

   `-dname` membuat pertanyaan identitas tidak ditanyakan satu-satu. Yang tetap
   diminta dua password: satu untuk keystore, satu untuk kunci — menjawab Enter di
   prompt *Enter key password* berarti keduanya sama. Simpan di pengelola password,
   bukan di repo.

   Lalu catat dua angkanya. Yang pertama identitas berkas, yang kedua identitas
   kunci — yang menentukan apakah sebuah APK bisa menerima pembaruan adalah yang
   kedua:

   ```sh
   sha256sum kb-release.jks
   keytool -list -v -alias kb-release -keystore kb-release.jks | grep 'SHA256:'
   ```

   Peringatan *"migrate to PKCS12"* dari keytool sengaja diabaikan: Gradle membaca
   JKS dengan baik, dan migrasi menulis ulang berkas sehingga hash yang baru dicatat
   tidak berlaku lagi.

   Kalau belum yakin password kunci sama dengan password keystore, buktikan sebelum
   build 15 menit dibuang — perintah ini membaca kedua password tanpa mengubah apa
   pun (`Cannot recover key` = password kuncinya bukan yang kamu kira):

   ```sh
   keytool -importkeystore -srckeystore kb-release.jks -srcstoretype JKS \
     -destkeystore /tmp/probe.p12 -deststoretype PKCS12
   ```
4. **Backup `kb-release.jks` dan kedua password ke penyimpanan privat yang kamu
   kendalikan.** Secrets GitHub tidak bisa dibaca kembali. Kehilangan kunci ini
   berarti setiap pengguna harus uninstall dan memasang ulang dari nol — untuk
   aplikasi yang catatannya hanya ada di hp mereka, itu kehilangan data nyata.
5. Pasang keempat secret **dari mesin sendiri**, bukan dari dalam Codespace, dan
   dengan `gh` yang masuk sebagai pemilik repo. Diukur saat v1 dibuat: token
   Codespaces menolak keempat-empatnya dengan
   `failed to fetch public key: HTTP 403: Resource not accessible by integration`
   — identitas yang diberikan sebuah Codespace bukan izin menulis secrets.

   ```sh
   # dari mesin sendiri, setelah berkasnya diunduh dari panel Files
   sha256sum kb-release.jks     # harus sama dengan yang dicatat di langkah 3
   base64 -w0 kb-release.jks | gh secret set ANDROID_KEYSTORE_BASE64 \
     --repo ywildan/karsa-business
   gh secret set ANDROID_KEY_ALIAS --body 'kb-release' \
     --repo ywildan/karsa-business
   ```

   Dua password jangan dipakai lewat `--body`: perintah yang begitu masuk ke
   riwayat shell dan selamanya bisa dibaca ulang. Isi lewat **Settings → Secrets
   and variables → Actions → New repository secret**, atau `gh secret set NAMANYA`
   yang membaca stdin lalu Ctrl-D.

   | Nama | Isi |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | isi `base64 -w0 kb-release.jks` |
   | `ANDROID_KEY_ALIAS` | `kb-release` |
   | `ANDROID_KEYSTORE_PASSWORD` | password keystore |
   | `ANDROID_KEY_PASSWORD` | password kunci — sama dengan di atas kalau prompt *Enter key password* dijawab Enter |

   Cocokkan sha256 berkas sebelum upload, jangan percaya namanya. Browser memberi
   nama unduhan kedua sebagai `kb-release(1).jks`, dan yang hampir naik ke GitHub
   adalah `kb-release.jks` versi lama — kunci yatim yang passwordnya tidak dikenal
   siapa pun, dengan sidik jari yang tidak bisa dibuktikan asalnya.
6. Hapus Codespace-nya. `kb-release.jks` tidak boleh pernah masuk artifact
   workflow, bahkan di repo private: artifact adalah jalur bocor kunci privat.

## Membangun

| Workflow | Kapan | Hasil |
|---|---|---|
| `kb-validate.yml` | tiap push dan PR | format, analyzer, `flutter test` di VM; ikut men-parse semua berkas workflow. Tidak menyentuh Gradle. |
| `kb-build.yml` | push ke `main` yang menyentuh `app/**`, atau manual | APK release universal + Release GitHub kalau secret sudah lengkap |
| `debug-build.yml` | manual saja, saat `kb-build` merah dan ekornya tidak menjelaskan | build yang sama persis dengan `-v`; log utuh dikirim sebagai artifact 7 hari |
| `kb-release.yml` | nanti, saat ada pembaruan aplikasi | belum ada — lihat "Setelah v1" di bawah |

`kb-build.yml` sengaja **tidak** menggagalkan build kalau keempat secret belum
ada: ia menandai `configured=false` dan tetap menghasilkan APK release ber-signing
debug. Itu cara membuktikan seluruh jalur Gradle sebelum keystore ada. Konsekuensinya
harus diketahui: **APK debug-signed dan release-signed tidak bisa saling menimpa.**
Sebelum memasang APK ber-signing permanen yang pertama, uninstall versi sebelumnya.

## Lantai Android: 7.0 (API 24)

Dua fakta yang saling mengunci, keduanya diukur dari artefaknya sendiri lewat
`tool/apk_manifest.py`, bukan dari asumsi:

1. APK build pertama (run 36342528276) **tidak punya entri `META-INF/*.SF`
   maupun `*.RSA` sama sekali** — AGP 9.1.0 menandatangani dengan scheme v2
   saja. Scheme v2 baru dikenali Android mulai API 24.
2. Lantai bawaan Flutter 3.47.0 sudah 24: `minSdkVersion: Int = 24` di
   `FlutterExtension.kt` milik SDK di runner.

Dulu workflow menambal `minSdk` ke 23 — pola warisan dari repo Karsa yang lain,
tempat tambalnya menaikkan lantai. Di sini tambalan itu **tidak pernah bekerja**:
log build menulis `minSdk = 23` ke `build.gradle.kts`, tetapi manifest yang
terkompilasi di dalam APK tetap bilang 24. Jadi tidak ada janji palsu yang
sempat terpasang ke pengguna; yang ada hanyalah ilusi bahwa kitalah yang
menetapkan lantai itu.

Sekarang tidak ada satu pun berkas Gradle yang disunting.
`tool/check-android-floor.sh` membaca lantai dari SDK di runner dan membuat
build berhenti kalau ia turun di bawah 24, dan `tool/apk_manifest.py` membaca
ulang manifest dari artefak jadi. **Karsa Business membutuhkan Android 7.0 ke
atas**, dan angkanya datang dari alat, bukan dari catatan di README.

## Janji versi satu diperiksa di artefaknya

Manifest sumber boleh menulis "tidak ada INTERNET"; yang dipasang ke hp pengguna
adalah manifest hasil merge Gradle. Yang terbaca dari APK yang benar-benar
ter-build:

```
permissions  com.ywildan.karsabusiness.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
```

Satu-satunya izin yang diminta milik androidx.core — levelnya `signature`,
dipasang otomatis, dan tidak membuka jaringan. Tidak ada
`android.permission.INTERNET`. Langkah **Verify the built manifest** di
`kb-build.yml` memeriksanya setiap build, jadi janji "catatan tidak meninggalkan
hp" dijaga mesin.

## Verifikasi tanpa adb

Perangkat pengembang tidak punya `adb`, jadi yang bisa dicek hanyalah tanda tangan
dan angka.

1. Pasang APK di hp. Android 14/15 akan memperingatkan "aplikasi tidak tepercaya" —
   itu konsekuensi sideload, bukan kerusakan.
2. Bandingkan `sha256sum` berkas yang terunduh dengan isi artifact
   `karsa-business-apk-sha256-<commit>`.
3. Jalankan alur inti dan cocokkan dengan hitungan manual: modal awal → penjualan
   kredit → pembelian tunai → buka Ringkas. Kalau "Untung" tidak sama dengan yang
   kamu hitung di kertas, lapor sebagai bug, bukan sebagai angka yang wajar.
4. Pasang ulang APK yang sama di atasnya (bukan uninstall) dan pastikan catatan lama
   masih ada.

## Bukti

| Tahap | Run | Commit | Artifact | sha256 |
|---|---|---|---|---|
| APK debug-signed pertama | [36342528276](https://github.com/ywildan/karsa-business/actions/runs/36342528276) | `bbcd184` | 10939751969 | `77eda82118d0716ce7e3ef7e0cda1e27fe99d8854f7dc611b41b89defadfdaa8` |
| APK release-signed pertama | [36393328993](https://github.com/ywildan/karsa-business/actions/runs/36393328993) | `3664a0a` | 10957201625 | `1a7fb6be89df6834bff28822ea63426aea0b16685bc85ff3d79138dc80aa806e` |

Rilisnya: [`kb-v1.0.0`](https://github.com/ywildan/karsa-business/releases/tag/kb-v1.0.0).

Kunci yang menandatangani, dibaca `apksigner` dari berkas APK jadi pada run itu —
bukan dari keystoret di tangan seseorang:

```
V2 Signer: certificate SHA-256 digest
08:D7:53:97:82:68:0C:9B:0F:BA:A0:DD:62:87:F2:4F:C7:53:59:B0:31:7B:60:64:96:C1:DF:50:3E:4C:2E:33
alias kb-release, RSA 4096-bit, SHA384withRSA, berlaku 2026-09-28 sampai 2054-02-13
```

Sidik jari yang sama tertanam di `kb-build.yml` sebagai `KB_CERT_SHA256`. Ganti
`ANDROID_KEYSTORE_*` dengan kunci lain dan build berhenti dengan pesan yang
menyebut kedua sidik jari. Itu disengaja: **kunci ini berjanji menandatangani
setiap pembaruan sampai 2054**, dan menggantinya tanpa disengaja berarti semua hp
harus uninstall dan catatan pengguna dimulai dari nol. Kalau pergantian kunci memang
dikehendaki, angka di workflow itulah yang ikut diubah, dalam satu commit yang bisa
dibaca orang.

Ukuran yang benar untuk diperkirakan: APK universal yang diunduh pengguna dari
Release adalah **51.507.491 byte** — satu berkas yang memuat `libapp.so` dan
`libflutter.so` untuk tiga ABI, karena fitur pro dibuka oleh lisensi, bukan oleh
build terpisah. Angka 23,8 MB yang pernah tercatat di dokumen ini adalah ukuran
*artifact* Actions, yang di-zip saat diunggah; itu bukan ukuran unduhan pengguna.
Dan karena distribusinya sideload, tidak ada pemisahan per-ABI seperti Play Store:
yang turun ke hp ya utuh. Kalau suatu hari ukuran jadi keluhan, jalurnya
`flutter build apk --split-per-abi` dan pengguna mengunduh salah satu dari tiga.

Diisi dari artefak yang benar-benar diunduh Actions, bukan dari perkiraan. Yang
belum ada di tabel itu adalah pasangannya di hp: belum ada satu pun angka yang
dicocokkan dengan hitungan kertas oleh pengguna nyata.

## Setelah v1

- `version` di `app/pubspec.yaml` dinaikkan (mis. `1.0.1+2`); `--build-number`
  mengikuti nomor run Actions, jadi `versionCode` selalu naik tanpa disentuh manual.
- Tag rilis dibuat workflow: `kb-v<version>`. Kalau tag sudah ada, langkah rilis
  berhenti dengan pesan jelas, bukan membuat duplikat.
- Versi dua menambahkan izin `INTERNET` bersamaan dengan Worker-nya — manifest
  tanpa izin itu adalah janji versi gratis, jadi perubahannya harus disengaja.

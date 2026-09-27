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
     -alias kb-release -keyalg RSA -keysize 4096 -validity 10000
   ```

   `CN=Karsa Business, OU=Apps, O=Ywildan, L=Semarang, ST=Jawa Tengah, C=ID`
   cukup. Dua password diminta: satu untuk keystore, satu untuk kunci. Simpan
   keduanya di pengelola password, bukan di repo.
4. **Backup `kb-release.jks` dan kedua password ke penyimpanan privat yang kamu
   kendalikan.** Secrets GitHub tidak bisa dibaca kembali. Kehilangan kunci ini
   berarti setiap pengguna harus uninstall dan memasang ulang dari nol — untuk
   aplikasi yang catatannya hanya ada di hp mereka, itu kehilangan data nyata.
5. Pasang empat secrets. Yang ini dikirim tanpa pernah ditampilkan:

   ```sh
   base64 -w0 kb-release.jks | gh secret set ANDROID_KEYSTORE_BASE64 \
     --repo ywildan/karsa-business
   ```

   Tiga sisanya lewat **Settings → Secrets and variables → Actions**, karena
   token Codespaces sering tidak punya izin menulis secrets:

   | Nama | Isi |
   |---|---|
   | `ANDROID_KEYSTORE_PASSWORD` | password keystore |
   | `ANDROID_KEY_ALIAS` | `kb-release` |
   | `ANDROID_KEY_PASSWORD` | password kunci |
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

## Lantai Android: 7.0

APK pertama yang ter-build (run 36342528276) diperiksa isi artefaknya, dan ia
**tidak punya entri `META-INF/*.SF` maupun `*.RSA` sama sekali**: AGP 9.1.0
menandatangani dengan scheme v2 saja. Scheme v2 baru dikenali Android mulai API
24. Dulu workflow menambal `minSdk` ke 23 — pola warisan dari repo Karsa yang
lain, tempat tambalnya menaikkan lantai, bukan menurunkan. Di Flutter 3.47
lantai bawaan sudah 24, sehingga tambalan itu cuma menghasilkan aplikasi yang
berjanji bisa dipasang di Android 6 padahal tanda tangannya tidak bisa
diverifikasi di sana.

Sekarang tidak ada satu pun berkas Gradle yang disunting. `tool/check-android-floor.sh`
membaca `minSdkVersion` dari SDK yang terpasang di runner dan membuat build
berhenti kalau lantai turun di bawah 24. Jadi **Karsa Business membutuhkan
Android 7.0 ke atas**, dan janji itu dijaga mesin, bukan oleh catatan di README.

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
| APK release-signed pertama | | | | |

Ukuran APK universal itu 51,5 MB sebelum dikompres, 23,8 MB setelah: satu
berkas memuat `libapp.so` dan `libflutter.so` untuk tiga ABI, karena fitur pro
dibuka oleh lisensi, bukan oleh build terpisah. Yang diunduh pengguna hanyalah
bagian yang dibutuhkan hp-nya.

Diisi begitu tiap baris benar-benar ada. Tabel ini dibiarkan kosong daripada
terisi perkiraan.

## Setelah v1

- `version` di `app/pubspec.yaml` dinaikkan (mis. `1.0.1+2`); `--build-number`
  mengikuti nomor run Actions, jadi `versionCode` selalu naik tanpa disentuh manual.
- Tag rilis dibuat workflow: `kb-v<version>`. Kalau tag sudah ada, langkah rilis
  berhenti dengan pesan jelas, bukan membuat duplikat.
- Versi dua menambahkan izin `INTERNET` bersamaan dengan Worker-nya — manifest
  tanpa izin itu adalah janji versi gratis, jadi perubahannya harus disengaja.

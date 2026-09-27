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
| `kb-validate.yml` | tiap push dan PR | format, analyzer, `flutter test` di VM. Tidak menyentuh Gradle. |
| `kb-build.yml` | push ke `main` yang menyentuh `app/**`, atau manual | APK release universal + Release GitHub kalau secret sudah lengkap |
| `kb-release.yml` | nanti, saat ada pembaruan aplikasi | belum ada — lihat "Setelah v1" di bawah |

`kb-build.yml` sengaja **tidak** menggagalkan build kalau keempat secret belum
ada: ia menandai `configured=false` dan tetap menghasilkan APK release ber-signing
debug. Itu cara membuktikan seluruh jalur Gradle sebelum keystore ada. Konsekuensinya
harus diketahui: **APK debug-signed dan release-signed tidak bisa saling menimpa.**
Sebelum memasang APK ber-signing permanen yang pertama, uninstall versi sebelumnya.

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
| APK debug-signed pertama | | | | |
| APK release-signed pertama | | | | |

Diisi begitu tiap baris benar-benar ada. Tabel ini dibiarkan kosong daripada
terisi perkiraan.

## Setelah v1

- `version` di `app/pubspec.yaml` dinaikkan (mis. `1.0.1+2`); `--build-number`
  mengikuti nomor run Actions, jadi `versionCode` selalu naik tanpa disentuh manual.
- Tag rilis dibuat workflow: `kb-v<version>`. Kalau tag sudah ada, langkah rilis
  berhenti dengan pesan jelas, bukan membuat duplikat.
- Versi dua menambahkan izin `INTERNET` bersamaan dengan Worker-nya — manifest
  tanpa izin itu adalah janji versi gratis, jadi perubahannya harus disengaja.

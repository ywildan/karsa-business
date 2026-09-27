# Karsa Business

**Pembukuan bisnis kecil untuk mahasiswa.** Satu APK, dua tingkatan: versi gratis yang seluruh
datanya hidup di HP, dan versi berbayar yang menambahkan sinkronisasi plus dashboard analitik di web.

_Laporan keuangan warung, reseller, dan jasa kecil — tanpa perlu akuntansi._

> Dokumen sumber kebenaran: [`docs/pandangan-produk.html`](docs/pandangan-produk.html)

---

## Status

**Fase C0 — kerangka repo dan rancangan teknis.** Belum ada kode Dart, belum ada workflow, belum
ada APK. Yang sudah ada hanya dokumen rancangan.

Jangan diklaim sebagai fitur yang berjalan: sinkronisasi cloud, lisensi, dan dashboard web.
Semuanya dirancang di dokumen tersebut dan baru dikerjakan setelah versi 1 gratis menghasilkan
APK yang bisa dipasang.

## Kenapa tidak ada `android/`

Laptop pengembangan ini tidak punya Flutter, Dart, Java, atau Android SDK — dan tidak akan
menginstalnya. GitHub Actions adalah satu-satunya mesin build:

1. Runner menjalankan `flutter create` untuk membangkitkan proyek Flutter yang sehat.
2. Sumber dari repo di-overlay ke atasnya: `pubspec.yaml`, `lib/`, `test/`, `assets/`, dan satu
   `AndroidManifest.xml`.
3. Berarti tidak ada satu pun berkas Gradle yang perlu dipelihara manual, dan naik versi Flutter
   tidak meninggalkan konflik konfigurasi yang tidak bisa diperbaiki lokal.

Pola ini sudah terbukti menghasilkan APK bertanda tangan di `ywildan/karsa`.

## Struktur yang direncanakan

```text
Karsa Business/
  docs/
    pandangan-produk.html   rancangan lengkap: 12 blok, dari model data sampai anggaran Rp 0
  app/
    pubspec.yaml            dependensi dipin eksak, tanpa caret
    android/
      AndroidManifest.xml   satu-satunya berkas native yang dimiliki repo
    lib/
      domain/               murni Dart, tanpa import flutter — bisa diuji di CI tanpa emulator
      data/                 SQLite: skema, repositori, outbox delta
      features/             layar per area: transaksi, laporan, dashboard, pengaturan
    test/
  .github/workflows/
    kb-validate.yml         loop dalam, <= 4 menit, tanpa build Android
    kb-build.yml            hanya main: APK release-signed -> GitHub Release
    debug-build.yml         build verbose + log lengkap, dipanggil manual
  migrations/               DDL Neon, diterapkan lewat workflow, tidak otomatis
  api/                      Cloudflare Workers: lisensi + sync + report
  web-dashboard/            statis + Chart.js, baca-saja
```

## Verifikasi di CI

```bash
gh run list --repo ywildan/karsa-business
gh run watch --repo ywildan/karsa-business
```

## Rilis

APK dipasang manual (sideload) dari GitHub Releases — Play Store butuh biaya sekali bayar yang
membatalkan target Rp 0. Penanda tanganan butuh empat secret dan satu keystore yang dibuat di
GitHub Codespaces, bukan di laptop.

## Kontak

`yuwiaffa@gmail.com`

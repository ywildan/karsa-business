# Karsa Business

**Pembukuan bisnis kecil untuk mahasiswa.** Satu APK, dua tingkatan: versi gratis yang seluruh
datanya hidup di HP, dan versi berbayar yang menambahkan sinkronisasi plus dashboard analitik di web.

_Laporan keuangan warung, reseller, dan jasa kecil — tanpa perlu akuntansi._

> Dokumen sumber kebenaran: [`docs/pandangan-produk.html`](docs/pandangan-produk.html)

---

## Status

**C0–C4 selesai. APK release-signed pertama sudah ada sebagai Release
[`kb-v1.0.0`](https://github.com/ywildan/karsa-business/releases/tag/kb-v1.0.0). C5 dan C6
menunggu akun cloud.**

Yang sudah benar-benar ada dan terbukti di CI:

- Aplikasi Flutter + SQLite: catat modal, penjualan, piutang, pengeluaran; double-entry bekerja di
  mesin dan tidak pernah terlihat di layar; laporan dan dashboard v1 dihitung dari jurnalnya.
- Alur inti diuji sebagai perjalanan layar yang sebenarnya, bukan hanya fungsi di bawah: membuka
  usaha, menambah pihak, mencoba mencatat penjualan tanpa pihak (ditolak, alasannya terbaca),
  lalu mencatatnya dan membandingkan angka ringkasan dengan hitungan manual — piutang naik, kas
  tidak bergerak.
- APK-nya dibangun Actions dan ditandatangani kunci release khusus Karsa Business. Setiap build
  membaca ulang sidik jari kunci dari APK jadi dan berhenti kalau kuncinya bukan yang
  didokumentasikan. Distribusinya tetap sideload: tidak ada jalur upgrade otomatis, jadi
  pembaruan dipasang sendiri oleh pengguna dari halaman Release.
- Sisi server versi 2 (`api/`): aturan lisensi, delta sync, perapian tombstone dan laporan neraca
  saldo. 95 tes jalan di Node tanpa satu paket pun terpasang di laptop.
- Satu workflow `Validate` dengan dua job: Dart/Flutter dan Worker. Analyzer dikeluarkan sebagai
  anotasi per baris dan berkas workflow ikut diperiksa, jadi kegagalan terbaca tanpa membongkar
  log mentah.

Yang belum ada, dan jangan dibaca sebagai fitur yang berjalan: deploy Worker dan Neon, dashboard
web, aktivasi kode lisensi dari HP, dan sinkronisasi nyata antara HP dengan cloud. Logikanya sudah
ditulis dan sudah diuji melawan model server di dalam tes — yang belum ada hanya sambungannya ke
dunia, dan itu butuh akun cloud.

## Kenapa tidak ada `android/`

Laptop pengembangan ini tidak punya Flutter, Dart, Java, atau Android SDK — dan tidak akan
menginstalnya. GitHub Actions adalah satu-satunya mesin build:

1. Runner menjalankan `flutter create` untuk membangkitkan proyek Flutter yang sehat.
2. Sumber dari repo di-overlay ke atasnya: `pubspec.yaml`, `lib/`, `test/`, `assets/`, dan satu
   `AndroidManifest.xml`.
3. Berarti tidak ada satu pun berkas Gradle yang perlu dipelihara manual, dan naik versi Flutter
   tidak meninggalkan konflik konfigurasi yang tidak bisa diperbaiki lokal.

Pola ini sudah terbukti menghasilkan APK bertanda tangan di `ywildan/karsa`.

## Struktur

```text
Karsa Business/
  docs/
    pandangan-produk.html   rancangan lengkap: 12 blok, dari model data sampai anggaran Rp 0
  app/
    pubspec.yaml            dependensi dipin eksak, tanpa caret
    android/
      AndroidManifest.xml   satu-satunya berkas native yang dimiliki repo
    lib/
      core/                   uang dan format — tidak tahu apa pun tentang flutter
      domain/                 murni Dart, tanpa import flutter: jurnal, laporan, aturan sync
      data/                   SQLite: skema, repositori, outbox, sesi sinkron
      features/               layar per area: kerangka, panduan awal, jurnal, akun, pihak,
                              bisnis, dashboard, pengaturan
      state/ theme/
    test/
  .github/workflows/
    kb-validate.yml         loop dalam, <= 4 menit, tanpa build Android
    kb-build.yml            hanya main: APK release-signed -> GitHub Release
    debug-build.yml         build verbose + log lengkap, dipanggil manual
  migrations/               DDL Neon, diterapkan lewat workflow, tidak otomatis
  api/                      Cloudflare Workers: lisensi + sync + report, diuji dengan Node saja
  tool/                     penjaga lokal: impor Dart, kurung seimbang, YAML workflow
```

## Verifikasi tanpa memasang apa pun

Semua yang bisa dibuktikan di laptop ini dibuktikan di laptop ini. Tidak ada `node_modules`,
tidak ada Flutter, tidak ada SDK:

```bash
cd api && npm test                    # aturan sync + lisensi + SQL, jalan di Node 26 apa adanya
python3 tool/check_imports.py         # simbol yang dipakai tanpa mengimpor rumahnya
python3 tool/check_dart.py app        # kurung dan kutip yang tidak seimbang
python3 tool/check_workflows.py       # plain scalar yang membuat Actions mati tanpa log
```

Sisanya hanya hidup di CI: `dart analyze`, `flutter test` (termasuk SQLite lewat FFI), format
Dart, dan seluruh jalur Android.

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

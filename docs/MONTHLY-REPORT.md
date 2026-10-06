# Laporan bulanan Premium

Menu **Laporan** membantu pemilik membaca perubahan usaha dari catatan yang sudah disinkronkan. Ringkasan usaha menampilkan kesimpulan singkat dan tombol membuka laporan lengkap. Pilihan bisnis dan bulan di bagian atas berlaku untuk laporan, rincian, dan unduhan.

## Isi laporan

- Masuk, Keluar, dan Laba dengan perubahan nominal serta persentase ketika ada pembanding yang valid.
- Penjelasan perubahan laba: laba sebelumnya + perubahan pemasukan − perubahan pengeluaran = laba periode ini.
- Tiga kategori pemasukan dan pengeluaran dengan perubahan nominal terbesar. Nama kategori membuka transaksi pada periode laporan dengan filter kategori dan jenis transaksi yang tepat.
- Semua perubahan kategori biaya, termasuk biaya baru dan biaya yang berhenti tercatat.
- Perbandingan hasil antarbisnis, diurutkan berdasarkan laba tercatat; pilih nama bisnis untuk melihat laporan khusus bisnis tersebut.
- Lima produk penyumbang omzet terbesar, jumlah terjual, dan porsi dari seluruh pemasukan. Persentase cakupan menunjukkan berapa banyak pemasukan yang sudah terhubung ke produk.
- Unduhan CSV laporan lengkap, mencakup periode pembanding, ringkasan, kategori, bisnis, dan produk. **Cetak / PDF** menggunakan fungsi cetak browser; pilih Simpan sebagai PDF.

## Dasar perbandingan

Bulan berjalan dihitung dari tanggal 1 sampai tanggal hari ini (termasuk catatan sepanjang tanggal hari ini), dibandingkan tanggal 1 sampai tanggal yang sama pada bulan sebelumnya. Jika bulan sebelumnya lebih pendek, batasnya adalah akhir bulan tersebut. Bulan yang sudah berlalu menggunakan seluruh bulan dibandingkan seluruh bulan sebelumnya. Catatan setelah batas periode dan transaksi yang sudah dihapus tidak masuk laporan.

Bulan mendatang menampilkan informasi bahwa periode belum dimulai. Jika salah satu periode belum mempunyai catatan, aplikasi tidak mengklaim usaha mengalami pertumbuhan atau penurunan; pembanding ditandai belum tersedia. Persentase tidak dihitung dari nominal pembanding nol atau negatif. Bisnis yang belum mempunyai data tetap terlihat di akhir perbandingan dengan jumlah transaksi nol, agar tidak dianggap lebih sehat daripada bisnis dengan aktivitas tercatat.

Laba di sini adalah selisih pemasukan dan pengeluaran **yang tercatat**. Dashboard belum menghitung HPP produk, penyusutan, piutang, dan nilai persediaan. Produk diurutkan menurut omzet penjualan sebenarnya, bukan harga katalog saat ini. Laporan tidak mengklaim laba per produk.

Tanggal mengikuti zona waktu lokal browser, konsisten dengan pencatatan transaksi web yang sudah ada. Gunakan zona waktu yang sama saat membandingkan laporan dari dua perangkat.

## Validasi

Dengan dependency yang sudah tersedia, jalankan `node --test backend/tests/*.test.mjs` dan pemeriksaan TypeScript backend. Unit test laporan mencakup cutoff bulan berjalan, pergantian tahun, tahun kabisat, bulan pembanding lebih pendek, data kosong, basis negatif/nol, perubahan kategori, bisnis kosong, omzet produk, dan keamanan teks CSV.

Browser smoke menggunakan fixture Firebase dan schema PostgreSQL sementara, tanpa mengakses data produksi. Pengujian mencakup pilihan bulan/bisnis, penelusuran kategori, unduhan CSV yang sesuai bisnis, cetak PDF, dan layout HP, bersama alur transaksi/stok dan akses Premium yang sudah ada.

Fitur ini tidak memerlukan environment variable, perubahan database, atau dependency tambahan. Versi lokal belum tampil pada deployment Vercel sampai perubahan dipublikasikan.

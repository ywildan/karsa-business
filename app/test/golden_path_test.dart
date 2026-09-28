import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:karsa_business/app.dart';
import 'package:karsa_business/domain/ledger_engine.dart';
import 'package:karsa_business/features/dashboard/dashboard_screen.dart';
import 'package:karsa_business/features/ledger/entry_form_screen.dart';
import 'package:karsa_business/state/app_controller.dart';
import 'package:karsa_business/theme/app_theme.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

// Tanpa tes jenis ini, tujuh layar aplikasi cuma diperiksa `dart analyze`: yang
// diuji di sini bukan angka di dalam engine, tapi orang yang membuka aplikasi,
// mengetik lewat keyboard, dan membaca hasilnya di ringkasan.
//
// Setiap tes mulai dari basis data di memori yang kosong, persis seperti
// pemasangan pertama di hp.

/// Buku yang sedang dibuka. [flush] membacanya untuk tahu kapan tulisan ke
/// basis data benar-benar selesai; layar tidak pernah tahu hal itu.
late AppController book;

/// Permukaan selebar hp (360x800). Semua form hidup di dalam ListView, jadi
/// kanvas selebar tablet akan menyembunyikan hal yang justru ingin dilihat.
void usePhoneSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<AppController> openBook() =>
    AppController.launch(path: inMemoryDatabasePath);

Future<void> showApp(WidgetTester tester) async {
  await tester.pumpWidget(KarsaBusinessApp(controller: book));
  await tester.pumpAndSettle();
}

/// Kolom isian dikenali dari teks contoh yang tercetak di dalamnya.
Finder field(String hint) => find.widgetWithText(TextField, hint);

Finder inSheet(String text) {
  final sheet = find.byType(BottomSheet);
  return find.descendant(of: sheet, matching: find.text(text));
}

/// Baris chip jenis transaksi: satu-satunya ListView yang mengguling mendatar.
final Finder kindRow = find.byWidgetPredicate(_isChipRow);

/// Layar catat, terbuka atau tertutup. Judulnya tidak dipakai sebagai penanda:
/// kata "Catat transaksi" juga melekat pada tombol tambah di layar Catatan.
final Finder entryForm = find.byType(EntryFormScreen);

/// Tombol simpan di layar catat.
final Finder saveButton = find.text('Simpan catatan');

bool _isChipRow(Widget widget) =>
    widget is ListView && widget.scrollDirection == Axis.horizontal;

/// Menyimpan itu kerja nyata: basis data tidak menjawab dalam satu frame waktu
/// palsu, jadi ia diberi ruang sampai controller selesai, baru tampilan dipacu.
Future<void> flush(WidgetTester tester) async {
  await tester.runAsync(() async {
    await Future<void>.delayed(const Duration(milliseconds: 30));
    for (var i = 0; i < 60 && book.busy; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
  });
  await tester.pump();
}

/// Sentuhan yang jujur: target ditarik ke layar dulu, karena semua form hidup
/// di dalam ListView yang bisa menggulir pergi darinya.
///
/// Gulirannya bergerak pelan, jadi frame harus dipacu sebelum jari turun:
/// menyentuh tanpa menunggu hanya akan mengenai koordinat yang lama.
Future<void> touch(WidgetTester tester, Finder target) async {
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

Future<void> touchAndSave(WidgetTester tester, Finder target) async {
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await flush(tester);
  await tester.pumpAndSettle();
}

Future<void> openTab(WidgetTester tester, String label) async {
  // Labelnya dicari di dalam NavigationBar saja, karena layar Catatan punya
  // judul "Catatan" yang sama persis.
  final bar = find.byType(NavigationBar);
  await tester.tap(find.descendant(of: bar, matching: find.text(label)));
  await tester.pumpAndSettle();
}

Future<void> startBusiness(WidgetTester tester, String name) async {
  await tester.enterText(field('Warung Kopi Sore'), name);
  await touchAndSave(tester, find.text('Mulai mencatat'));
}

/// Baris chip hanya memuat tiga jenis sekaligus dan sisanya belum dibangun sama
/// sekali, jadi ia ditarik sampai yang dicari muncul; sesudah itu [touch] yang
/// menempatkannya di tempat yang bisa disentuh.
Future<void> pickKind(WidgetTester tester, EntryKind kind) async {
  final chip = find.widgetWithText(ChoiceChip, kind.label);
  for (var i = 0; i < 10 && chip.evaluate().isEmpty; i++) {
    await tester.drag(kindRow, const Offset(-120, 0));
    await tester.pumpAndSettle();
  }
  await touch(tester, chip);
}

/// Satu catatan, dikerjakan lewat layar catat: pilih jenis, ketik nominal,
/// tentukan pos kalau jenis itu memintanya, lalu simpan.
Future<void> record(
  WidgetTester tester, {
  required EntryKind kind,
  required String amount,
  String? cost,
  String? account,
}) async {
  await touch(tester, find.text('Catat'));
  expect(entryForm, findsOneWidget);

  await pickKind(tester, kind);
  await tester.enterText(field('25.000'), amount);
  if (account != null) {
    await touch(tester, find.text('POS'));
    await touch(tester, inSheet(account));
  }
  if (cost != null) await tester.enterText(field('10.000'), cost);

  await touchAndSave(tester, saveButton);
  expect(entryForm, findsNothing);
}

/// Menutup lembar dengan menyentuh luarnya: tidak ada tombol tutup di sana,
/// dan itulah cara orang benar-benar menutupnya.
Future<void> closeSheet(WidgetTester tester) async {
  await tester.tapAt(const Offset(10, 10));
  await tester.pumpAndSettle();
  expect(find.byType(BottomSheet), findsNothing);
}

void expectCard(WidgetTester tester, String label, String value) {
  final card = find.widgetWithText(StatCard, label.toUpperCase());
  expect(
    find.descendant(of: card, matching: find.text(value)),
    findsOneWidget,
    reason: 'kartu "$label" seharusnya menampilkan $value',
  );
}

void expectSummary(WidgetTester tester, String label, String value) {
  final row = find.ancestor(of: find.text(label), matching: find.byType(Row));
  expect(
    find.descendant(of: row, matching: find.text(value)),
    findsOneWidget,
    reason: '"$label" seharusnya menampilkan $value',
  );
}

/// Baris yang belum cukup dekat dengan layar tidak dibangun sama sekali:
/// ListView menata isinya dengan malas, persis seperti di hp. [delta] negatif
/// menurunkan daftar, positif mengembalikannya ke atas. Cariannya dikunci ke
/// dalam ringkasan saja, karena tab catatan juga menyebut angka yang sama.
Future<void> scrollRingkas(
  WidgetTester tester,
  String text, {
  required double delta,
}) async {
  final ringkas = find.byType(DashboardScreen);
  final target = find.descendant(of: ringkas, matching: find.text(text));
  final list = find.descendant(of: ringkas, matching: find.byType(Scrollable));
  await tester.scrollUntilVisible(target, delta, scrollable: list);
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  // Membuka basis data adalah kerja nyata, jadi ia terjadi di luar zona waktu
  // palsu tes widget; hanya ketikan dan sentuhan yang hidup di dalam zona itu.
  // Buku ditutup lagi sebab sqflite mengenalinya dari lokasinya: tanpa ditutup,
  // kasus berikutnya mewarisi catatan kasus sebelumnya.
  setUp(() async {
    book = await openBook();
    addTearDown(book.close);
  });

  testWidgets('dari nama usaha sampai angka di ringkasan', (tester) async {
    usePhoneSurface(tester);
    await showApp(tester);

    await startBusiness(tester, 'Warung Kopi Sore');
    expect(find.text('Warung Kopi Sore'), findsOneWidget);
    expect(find.text('Belum ada satu catatan pun'), findsOneWidget);

    await record(tester, kind: EntryKind.modalAwal, amount: '300.000');
    expectCard(tester, 'Saldo kas', 'Rp 300.000');
    expectCard(tester, 'Pendapatan', 'Rp 0');

    await record(
      tester,
      kind: EntryKind.penjualanTunai,
      amount: '25.000',
      cost: '10.000',
    );
    expectCard(tester, 'Pendapatan', 'Rp 25.000');
    expectCard(tester, 'Beban', 'Rp 10.000');
    expectCard(tester, 'Untung', 'Rp 15.000');
    expectCard(tester, 'Saldo kas', 'Rp 325.000');

    await record(
      tester,
      kind: EntryKind.pengeluaran,
      amount: '5.000',
      account: '6200 · Beban Operasional',
    );
    // Hitungan tangan: 25.000 masuk, 10.000 modal barang + 5.000 beban keluar,
    // uang tinggal 300.000 + 25.000 - 5.000.
    expectCard(tester, 'Beban', 'Rp 15.000');
    expectCard(tester, 'Untung', 'Rp 10.000');
    expectCard(tester, 'Saldo kas', 'Rp 320.000');
    expect(find.text('margin 40%'), findsOneWidget);
    expect(find.text('Harga Pokok Penjualan'), findsOneWidget);
    await scrollRingkas(tester, 'Nilai stok di rak', delta: -160.0);
    expectSummary(tester, 'Nilai stok di rak', '-Rp 10.000');
    // Kembali ke atas: kartu saldo kas masih dibutuhkan oleh perbandingan di
    // bawah, dan ia tidak ikut terbangun lagi kalau daftar ditinggal di tengah.
    await scrollRingkas(tester, 'Rp 320.000', delta: 160.0);

    await openTab(tester, 'Catatan');
    expect(find.text('Hari ini'), findsOneWidget);
    expect(find.text('Modal awal'), findsOneWidget);
    // Ringkasan dan daftar harus menyebut angka yang sama: yang satu saldo kas
    // seluruh bulan, yang satu uang hari ini — dan hari ini memang semuanya.
    expect(find.text('Rp 320.000'), findsNWidgets(2));

    await touch(tester, find.text('Jualan, langsung bayar'));
    expect(inSheet('Debit Rp 25.000'), findsOneWidget);
    expect(inSheet('Kredit Rp 25.000'), findsOneWidget);
    expect(inSheet('Kredit Rp 10.000'), findsOneWidget);
    await closeSheet(tester);
  });

  testWidgets('jualan belum dibayar menuntut nama', (tester) async {
    usePhoneSurface(tester);
    await showApp(tester);
    await startBusiness(tester, 'Warung Kopi Sore');

    await openTab(tester, 'Usaha');
    await touch(tester, find.text('Pihak'));
    await touch(tester, find.widgetWithText(FilledButton, 'Tambah pihak'));
    await tester.enterText(field('Rina'), 'Rina');
    await touchAndSave(tester, find.widgetWithText(FilledButton, 'Simpan'));
    expect(find.text('Rina'), findsOneWidget);
    await tester.pageBack();

    await touch(tester, find.text('Catat'));
    await pickKind(tester, EntryKind.penjualanKredit);
    await tester.enterText(field('25.000'), '30.000');

    // Disimpan tanpa nama: mesin menolak, layar tidak berpindah, dan alasannya
    // dibaca dalam bahasanya sendiri.
    await tester.ensureVisible(saveButton);
    await tester.tap(saveButton);
    await flush(tester);
    expect(find.text('Catat dulu ini urusan dengan siapa.'), findsOneWidget);
    expect(entryForm, findsOneWidget);

    // Pesan penolakan bertahan lima detik. Ditunggu sampai benar-benar tutup,
    // supaya sentuhan berikutnya tidak jatuh ke atasnya.
    await tester.pump(const Duration(seconds: 6));
    await tester.pumpAndSettle();
    expect(find.byType(SnackBar), findsNothing);

    await touch(tester, find.text('PIHAK'));
    await touch(tester, inSheet('Rina'));
    await touchAndSave(tester, saveButton);
    expect(entryForm, findsNothing);

    // Piutang lahir dari jurnal, bukan dari diketik: kas belum bergerak.
    expectCard(tester, 'Saldo kas', 'Rp 0');
    expectCard(tester, 'Pendapatan', 'Rp 30.000');
    await scrollRingkas(tester, 'Piutang di tangan pelanggan', delta: -160.0);
    expectSummary(tester, 'Piutang di tangan pelanggan', 'Rp 30.000');
  });

  testWidgets('menghapus catatan mengembalikan angka', (tester) async {
    usePhoneSurface(tester);
    await showApp(tester);
    await startBusiness(tester, 'Warung Kopi Sore');

    await record(tester, kind: EntryKind.modalAwal, amount: '300.000');
    await record(
      tester,
      kind: EntryKind.penjualanTunai,
      amount: '25.000',
      cost: '10.000',
    );
    expectCard(tester, 'Saldo kas', 'Rp 325.000');

    await openTab(tester, 'Catatan');
    await touch(tester, find.text('Jualan, langsung bayar'));
    await touch(tester, inSheet('Hapus'));
    await touchAndSave(tester, find.widgetWithText(FilledButton, 'Hapus'));

    expect(find.text('Jualan, langsung bayar'), findsNothing);
    expect(find.text('Modal awal'), findsOneWidget);
    await openTab(tester, 'Ringkas');
    expectCard(tester, 'Saldo kas', 'Rp 300.000');
    expectCard(tester, 'Pendapatan', 'Rp 0');
    expectCard(tester, 'Beban', 'Rp 0');
  });
}

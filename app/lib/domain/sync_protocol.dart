/// Aturan delta dan konflik antara hp dan Worker.
///
/// Murni Dart: tidak membuka basis data, tidak menyentuh jaringan, tidak
/// mengimpor flutter. Semua keputusannya bisa diuji di job validate satu
/// menit, jauh sebelum ada Neon, dan itulah satu-satunya cara percaya pada
/// jalur sinkron yang tidak bisa dijalankan di mesin pengembang.
///
/// Dua hal menentukan bentuknya. Pertama, jam perangkat tidak pernah memilih
/// pemenang: server yang men-stempel `updated_at` dan mengambil `nextval(rev)`
/// saat baris tiba, jadi urutan tiba adalah urutan menang. Kedua, satu siklus
/// sinkron boleh mati di tengah jalan tanpa kehilangan catatan apa pun —
/// baris yang belum diakui server tetap `dirty` dan diambil ulang dari
/// pengambilan delta yang sama.
library;

/// Keputusan untuk satu baris yang datang dari server.
enum PullOutcome {
  /// Tulis ke lokal dan bersihkan `dirty`.
  apply,

  /// Lokal masih menunggu dikirim. Editan pengguna tidak boleh ditimpa oleh
  /// versi lama: baris ini akan naik sendiri dan di-stempel ulang server.
  keepLocal,
}

/// Satu baris hasil `GET /sync/pull`.
class PullRow {
  const PullRow({
    required this.table,
    required this.id,
    required this.rev,
    required this.values,
  });

  final String table;
  final String id;
  final int rev;

  /// Isi kolom persis seperti kata server, termasuk `updated_at` capnya.
  final Map<String, Object?> values;

  String get key => '$table:$id';

  bool get isTombstone => values['deleted'] == 1;
}

abstract final class SyncProtocol {
  /// Baris per kiriman. Angka yang sama dengan blok 07 dokumen pandangan:
  /// cukup kecil supaya satu batch muat dalam satu transaksi lokal, cukup
  /// besar supaya tiga minggu catatan pegunungan tidak butuh ratusan minta.
  static const int pushBatch = 200;

  /// Baris per halaman unduhan.
  static const int pullPage = 500;

  /// Hari sebelum tombstone dikompaksi di server. Lokal tidak pernah menghapus
  /// fisik, jadi angka ini hanya membatasi seberapa jauh sejarah yang bisa
  /// ditarik kembali.
  static const int tombstoneRetentionDays = 30;

  /// Kolom yang boleh meninggalkan perangkat. Kolom lain di baris lokal —
  /// termasuk `dirty` — adalah urusan hp ini saja.
  static const Map<String, List<String>> wireColumns = {
    'business': ['id', 'name'],
    'party': ['id', 'business_id', 'name', 'phone', 'note'],
    'item': [
      'id',
      'business_id',
      'name',
      'unit',
      'sale_price',
      'buy_price',
      'tracks_stock',
    ],
    'account': ['id', 'business_id', 'code', 'name'],
    'ledger_entry': [
      'id',
      'business_id',
      'entered_on',
      'posted_at',
      'kind',
      'description',
      'party_id',
      'item_id',
      'quantity',
      'unit_price',
      'cash_account_code',
    ],
    'ledger_line': [
      'id',
      'entry_id',
      'business_id',
      'account_code',
      'debit',
      'credit',
    ],
    'stock_movement': [
      'id',
      'business_id',
      'item_id',
      'entered_on',
      'direction',
      'quantity',
      'unit_cost',
      'entry_id',
    ],
  };

  /// Kolom yang ikut naik supaya server tahu siapa pengubah terakhir dan
  /// kapan baris dibuat; `updated_at` naik sebagai laporan, meski server yang
  /// akan menentukannya ulang.
  static const List<String> stampedColumns = [
    'created_at',
    'updated_at',
    'deleted',
    'device_id',
  ];

  /// Kolom milik server. Kalau suatu hari bocor ke balasan, ia tidak boleh
  /// pernah ikut dikirim sebagai balas budi.
  static const Set<String> serverOwned = {'rev', 'owner_id'};

  /// Isi pesan `POST /sync/push` untuk satu baris.
  ///
  /// `dirty` dibuang, kolom yang tidak dikenal tabel dibuang, dan id tidak
  /// pernah diganti: kuncinya dibuat di perangkat justru supaya dua hp yang
  /// offline berbulan-bulan tidak menabrak nomor catatan yang sama.
  static Map<String, Object?> toWire(
    String table,
    Map<String, Object?> local,
  ) {
    final allowed = wireColumns[table];
    if (allowed == null) {
      throw ArgumentError.value(table, 'table', 'tabel ini tidak ikut sinkron');
    }
    final wire = <String, Object?>{};
    for (final column in [...allowed, ...stampedColumns]) {
      if (local.containsKey(column)) wire[column] = local[column];
    }
    return wire;
  }

  /// Urutan penerapan halaman unduhan.
  ///
  /// Server sudah mengirim berdasarkan rev naik, tetapi klien tidak boleh
  /// mempercayai itu: kursor hanya boleh maju ke rev terbesar yang benar-benar
  /// diterapkan, dan kalau dua versi baris sama muncul dalam satu halaman,
  /// yang rev-nya lebih besar harus jadi yang terakhir ditulis.
  static List<PullRow> orderForApply(Iterable<PullRow> page) {
    final newest = <String, PullRow>{};
    for (final row in page) {
      final known = newest[row.key];
      if (known == null || row.rev >= known.rev) newest[row.key] = row;
    }
    final ordered = newest.values.toList()
      ..sort((a, b) {
        final byRev = a.rev.compareTo(b.rev);
        return byRev != 0 ? byRev : a.key.compareTo(b.key);
      });
    return ordered;
  }

  /// Unduhan berikutnya dimulai dari mana.
  ///
  /// Mengambil rev terbesar, bukan jumlah baris: kalau halaman terakhir kosong
  /// kursor harus diam di tempat, dan kalau aplikasi mati di tengah halaman,
  /// rev yang belum diterapkan tidak boleh dianggap sudah sampai.
  static int watermark(Iterable<PullRow> applied, {required int notKnown}) {
    var highest = notKnown;
    for (final row in applied) {
      if (row.rev > highest) highest = row.rev;
    }
    return highest;
  }

  /// Keputusan satu baris yang datang, dilihat dari keadaan lokal.
  ///
  /// `localKnown == false` berarti barisnya belum ada di hp ini — selalu
  /// diterapkan. Selain itu, satu-satunya yang menahan penerapan adalah edits
  /// yang belum sempat naik: menghapus baris yang menunggu dikirim sama saja
  /// dengan membuang catatan pengguna saat sinyal baru saja datang.
  static PullOutcome decide({
    required bool localKnown,
    required bool localDirty,
  }) {
    if (!localKnown) return PullOutcome.apply;
    return localDirty ? PullOutcome.keepLocal : PullOutcome.apply;
  }

  /// Isi `UPDATE`/`INSERT` lokal untuk satu baris unduhan.
  ///
  /// `dirty` dimatikan karena baris ini baru saja diakui server, dan cap
  /// `updated_at` milik server dipakai apa adanya — itulah yang membuat
  /// pengiriman ulang setelah mati tengah jalan tetap menghasilkan angka yang
  /// sama. `device_id` pembuatnya ikut disimpan apa adanya, bukan diganti
  /// dengan id hp ini: kolom itu mencatat siapa yang menulis, dan menggantinya
  /// akan mengklaim baris milik perangkat lain sebagai buatan kita.
  static Map<String, Object?> localWrite(PullRow row) {
    final allowed = wireColumns[row.table];
    if (allowed == null) {
      throw ArgumentError.value(
        row.table,
        'row.table',
        'tabel ini tidak ikut sinkron',
      );
    }
    final values = <String, Object?>{};
    for (final column in [...allowed, ...stampedColumns]) {
      if (row.values.containsKey(column)) values[column] = row.values[column];
    }
    values['id'] = row.id;
    values['dirty'] = 0;
    return values;
  }
}

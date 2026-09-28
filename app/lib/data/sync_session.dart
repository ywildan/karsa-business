import 'package:sqflite/sqflite.dart';

import '../domain/sync_protocol.dart';
import 'db.dart';
import 'outbox.dart';

/// Satu baris menuju `POST /sync/push`.
class PushRow {
  const PushRow({required this.table, required this.id, required this.values});

  final String table;
  final String id;
  final Map<String, Object?> values;
}

/// Yang harus disediakan sisi jaringan. Worker nanti mengimplementasikan
/// persis ini; di job validate, satunya lagi berupa model server berbasis
/// memori. Dipisah lewat interface justru supaya aturan kirim-tarik bisa
/// dibuktikan tanpa akun cloud apa pun.
abstract interface class SyncTransport {
  /// Naikkan satu batch. Wajib melempar kalau server tidak mengakuinya —
  /// barisnya tetap `dirty` dan diambil ulang pada sesi berikutnya.
  Future<void> push(List<PushRow> rows);

  /// Baris dengan rev di atas [sinceRev], rev terkecil lebih dulu.
  ///
  /// [resync] menandai halaman lanjutan dari satu unduh ulang penuh:
  /// pengirimnya sedang memulihkan diri, jadi kursornya boleh di bawah floor.
  ///
  /// Wajib melempar [ResyncRequired] kalau server menjawab 409: sejarah di
  /// bawah kursor sudah diringkas dan tidak bisa dijanjikan lagi.
  Future<PullPage> pull({
    required int sinceRev,
    required bool resync,
    int limit,
  });
}

/// Hasil satu putaran sinkron.
class SyncReport {
  const SyncReport({required this.pushed, required this.pulled});

  /// Baris milik perangkat ini yang sudah diakui server.
  final int pushed;

  /// Baris dari perangkat lain yang ditulis ke hp ini.
  final int pulled;
}

/// Kirim perubahan dulu, baru ambil milik perangkat lain.
///
/// Urutan itu bukan gaya: baris yang masih `dirty` tidak boleh ditimpa
/// unduhan, jadi kalau sesi dimulai dengan push yang berhasil, halaman yang
/// datang sesudahnya sudah tidak menyangga catatan siapa pun.
class SyncSession {
  SyncSession({
    required this.db,
    required this.outbox,
    required this.transport,
  });

  final Database db;
  final Outbox outbox;
  final SyncTransport transport;

  Future<SyncReport> run() async {
    final pushed = await _push();
    final pulled = await _pull();
    return SyncReport(pushed: pushed, pulled: pulled);
  }

  Future<int> _push() async {
    var confirmed = 0;
    while (true) {
      final batch = await outbox.next(limit: SyncProtocol.pushBatch);
      if (batch.isEmpty) return confirmed;
      await transport.push([
        for (final row in batch)
          PushRow(
            table: row.table,
            id: row.id,
            values: SyncProtocol.toWire(row.table, row.values),
          ),
      ]);
      // Pengakuan server menutup dirty. Sampai langkah ini terjadi, barisnya
      // masih bisa diambil ulang dari sesi berikutnya.
      await outbox.confirm(batch);
      confirmed += batch.where((row) => !row.carried).length;
    }
  }

  Future<int> _pull() async {
    var total = 0;
    // Selama satu sejarah penuh dibaca, setiap id yang benar-benar datang
    // dicatat. Yang tidak datang bukan tersangkut di jalan: server sudah
    // melupakannya bersama tombstonenya, dan satu-satunya saksi yang tersisa
    // adalah hp ini.
    var resyncing = await _resyncing();
    if (resyncing && await cursor() > 0) {
      // Unduh ulang yang terpotong tidak dilanjut dari tengahnya. Daftar yang
      // tidak dimulai dari nol bukan daftar lengkap, dan hanya daftar lengkap
      // yang boleh dipakai menyimpulkan sebuah baris sudah dihapus. Harganya
      // satu sejarah dibaca dua kali, bukan catatan yang hilang.
      await KarsaDatabase.putMeta(db, kMetaLastPulledRev, '0');
    }
    var seen = <String>{};
    while (true) {
      final since = await cursor();
      if (since == 0) {
        // Permintaan dari nol adalah pembacaan sejarah penuh, jadi penandanya
        // dipasang sebelum halaman pertama tiba: halaman-halaman lanjutannya
        // boleh punya kursor di bawah floor server tanpa ditolak lagi.
        if (!resyncing) await _setResyncing(true);
        resyncing = true;
        seen = <String>{};
      }
      final page = await _attemptPull(since, resyncing: resyncing);
      if (page == null) {
        resyncing = true;
        continue;
      }
      seen.addAll([for (final row in page.rows) row.key]);
      var advanced = since;
      if (page.rows.isNotEmpty) {
        final outcome = await _applyPage(page.rows, notKnown: since);
        total += outcome.applied;
        advanced = outcome.cursor;
      }
      if (page.isLast) {
        // Rekonsiliasi hanya terjadi pada sejarah yang selesai dibaca. Sesi
        // yang mati di tengah daftar tidak boleh menghapus apa pun: sebagian
        // isi yang datang bukan daftar lengkap, dan memakainya sebagai bukti
        // "tidak ada" adalah cara paling pasti menghilangkan catatan yang
        // benar.
        if (resyncing) await _reconcile(seen, atLeast: page.nextRev);
        return total;
      }
      if (advanced <= since) {
        // Seluruh halaman ini kita tahan karena lokal masih menunggu dikirim,
        // atau server mengaku masih ada halaman tapi tidak mengirim apa pun.
        // Maju tidak mungkin, jadi sesi berhenti; penanda unduh ulang tetap
        // terpasang dan push berikutnya membersihkan dirty.
        return total;
      }
    }
  }

  /// Satu halaman, atau `null` kalau server menolak kursornya dan hp ini baru
  /// saja memutuskan mengulang dari sejarah penuh.
  Future<PullPage?> _attemptPull(int since, {required bool resyncing}) async {
    try {
      return await transport.pull(
        sinceRev: since,
        resync: resyncing,
        limit: SyncProtocol.pullPage,
      );
    } on ResyncRequired {
      if (resyncing) {
        // Server menolak permintaan yang sudah mengaku sedang memulihkan diri.
        // Tidak ada langkah yang tersisa di sisi hp: itu bug di sisi sana, dan
        // ia harus terdengar, bukan diam-diam diulang selamanya.
        rethrow;
      }
      // Kursor dan penanda ditulis bersama: halaman berikutnya dimulai dari
      // nol dengan pengakuan penuh, termasuk kalau mati tepat di sini.
      await db.transaction((txn) async {
        await KarsaDatabase.putMeta(txn, kMetaLastPulledRev, '0');
        await KarsaDatabase.putMeta(txn, kMetaResyncing, '1');
      });
      return null;
    }
  }

  /// Penutup satu sejarah penuh, dalam satu transaksi: baris bersih yang tidak
  /// datang dipensiunkan, kursor dinaikkan ke posisi yang dijanjikan server,
  /// dan penanda unduh ulang dilepas.
  ///
  /// Baris yang masih `dirty` tidak tersentuh: ia milik pengguna dan belum
  /// sampai, jadi tidak ada yang berhak menyimpulkan apa pun tentangnya. Dan
  /// karena kesimpulan lokal sengaja tidak ditandai dirty, hp tidak pernah
  /// mengirim balik baris yang sudah dilupakan server sebagai tombstone baru.
  Future<void> _reconcile(Set<String> seen, {required int atLeast}) async {
    await db.transaction((txn) async {
      for (final table in DbSchema.syncableTables) {
        final living = await txn.query(
          table,
          columns: ['id'],
          where: 'deleted = 0 AND dirty = 0',
        );
        for (final row in living) {
          final id = row['id'] as String;
          if (seen.contains('$table:$id')) continue;
          await txn.update(
            table,
            {'deleted': 1},
            where: 'id = ?',
            whereArgs: [id],
          );
        }
      }
      final stored = await KarsaDatabase.metaValue(txn, kMetaLastPulledRev);
      if (atLeast > (int.tryParse(stored ?? '') ?? 0)) {
        await KarsaDatabase.putMeta(txn, kMetaLastPulledRev, '$atLeast');
      }
      await KarsaDatabase.putMeta(txn, kMetaResyncing, '0');
    });
  }

  Future<bool> _resyncing() async =>
      await KarsaDatabase.metaValue(db, kMetaResyncing) == '1';

  Future<void> _setResyncing(bool value) =>
      KarsaDatabase.putMeta(db, kMetaResyncing, value ? '1' : '0');

  /// Kursor unduhan yang tersimpan; nol kalau hp ini belum pernah menarik.
  Future<int> cursor() async {
    final stored = await KarsaDatabase.metaValue(db, kMetaLastPulledRev);
    return int.tryParse(stored ?? '') ?? 0;
  }

  /// Satu halaman, satu transaksi. Baris dan kursor naik bersama, atau tidak
  /// sama sekali — itulah kenapa mati di tengah halaman boleh diulang dari
  /// kursor yang lama.
  Future<({int cursor, int applied})> _applyPage(
    List<PullRow> page, {
    required int notKnown,
  }) async {
    var applied = 0;
    var cursor = notKnown;
    await db.transaction((txn) async {
      final written = <PullRow>[];
      for (final row in SyncProtocol.orderForApply(page)) {
        if (await _keepLocal(txn, row)) continue;
        await txn.insert(
          row.table,
          SyncProtocol.localWrite(row),
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
        written.add(row);
      }
      cursor = SyncProtocol.watermark(written, notKnown: notKnown);
      await KarsaDatabase.putMeta(txn, kMetaLastPulledRev, '$cursor');
      applied = written.length;
    });
    return (cursor: cursor, applied: applied);
  }

  Future<bool> _keepLocal(DatabaseExecutor txn, PullRow row) async {
    final found = await txn.query(
      row.table,
      columns: ['dirty'],
      where: 'id = ?',
      whereArgs: [row.id],
      limit: 1,
    );
    return SyncProtocol.decide(
          localKnown: found.isNotEmpty,
          localDirty: found.isNotEmpty && found.first['dirty'] == 1,
        ) ==
        PullOutcome.keepLocal;
  }
}

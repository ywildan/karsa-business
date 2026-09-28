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
  /// Wajib melempar [ResyncRequired] kalau server menjawab 409: sejarah di
  /// bawah kursor sudah diringkas dan tidak bisa dijanjikan lagi.
  Future<List<PullRow>> pull({required int sinceRev, int limit});
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
    // Selama unduh ulang penuh, setiap id yang benar-benar datang dicatat.
    // Yang tidak datang bukan tersangkut di jalan: server sudah melupakannya
    // bersama tombstonenya, dan satu-satunya saksi yang tersisa adalah hp ini.
    var resyncing = false;
    var seen = <String>{};
    while (true) {
      final since = await cursor();
      final page = await _attemptPull(since);
      if (page == null) {
        resyncing = true;
        seen = <String>{};
        continue;
      }
      if (page.isEmpty) {
        // Rekonsiliasi hanya terjadi pada unduh ulang yang selesai. Sesi yang
        // mati di tengah sejarah tidak boleh menghapus apa pun: sebagian isi
        // yang datang bukan daftar lengkap, dan memakai daftar sebagian itu
        // sebagai bukti "tidak ada" adalah cara paling pasti menghilangkan
        // catatan yang benar.
        if (resyncing) await _retireUnseen(seen);
        return total;
      }
      seen.addAll(page.map((row) => row.key));
      final outcome = await _applyPage(page, notKnown: since);
      total += outcome.applied;
      if (outcome.cursor <= since) {
        // Seluruh halaman ini kita tahan karena lokal masih menunggu dikirim.
        // Maju tidak mungkin, jadi sesi berhenti; barisnya akan dicoba lagi
        // setelah push berikutnya membersihkan dirty.
        return total;
      }
    }
  }

  /// Satu halaman, atau `null` kalau server menolak kursornya dan kursor lokal
  /// baru saja dinolkan — pemanggil harus mengulang dari sejarah penuh.
  Future<List<PullRow>?> _attemptPull(int since) async {
    try {
      return await transport.pull(
        sinceRev: since,
        limit: SyncProtocol.pullPage,
      );
    } on ResyncRequired {
      if (since == 0) rethrow;
      // Tulis di luar transaksi halaman: belum ada baris yang disentuh, jadi
      // sesi yang mati tepat di sini mulai dari nol lagi, bukan dari tengah.
      await KarsaDatabase.putMeta(db, kMetaLastPulledRev, '0');
      return null;
    }
  }

  /// Baris bersih yang tidak muncul di seluruh sejarah server dinyatakan
  /// terhapus di sini saja — `deleted = 1`, dan `dirty` dibiarkan nol.
  ///
  /// Yang masih `dirty` tidak tersentuh: ia milik pengguna dan belum sampai,
  /// jadi tidak ada yang berhak menyimpulkan apa pun tentangnya. Dan karena
  /// kesimpulan lokal sengaja tidak ditandai dirty, hp tidak pernah mengirim
  /// balik baris yang sudah dilupakan server sebagai tombstone baru.
  Future<void> _retireUnseen(Set<String> seen) async {
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
    });
  }

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

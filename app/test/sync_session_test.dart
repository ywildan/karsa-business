import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:karsa_business/core/money.dart';
import 'package:karsa_business/data/db.dart';
import 'package:karsa_business/data/ledger_repository.dart';
import 'package:karsa_business/data/master_repository.dart';
import 'package:karsa_business/data/outbox.dart';
import 'package:karsa_business/data/sync_session.dart';
import 'package:karsa_business/domain/account.dart';
import 'package:karsa_business/domain/ledger.dart';
import 'package:karsa_business/domain/ledger_engine.dart';
import 'package:karsa_business/domain/sync_protocol.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Kegagalan jaringan, seperti yang nanti dilempar klien http.
class _Offline implements Exception {
  const _Offline();
}

class _Stored {
  _Stored(this.table, this.id, this.rev, this.values);

  final String table;
  final String id;
  final int rev;
  final Map<String, Object?> values;
}

/// Model dari Worker: satu pemilik, rev menaik tiap baris yang tiba, dan yang
/// terakhir tiba menang. Persis aturan blok 07, ditulis di sini supaya
/// kliennya bisa dibuktikan tanpa akun cloud apa pun.
class _Server {
  final Map<String, _Stored> _rows = {};
  int _rev = 0;

  /// rev terendah yang masih bisa dilayani; di bawahnya sejarah sudah ringkas.
  int _floor = 0;

  int get head => _rev;

  int get floor => _floor;

  void accept(List<PushRow> batch) {
    for (final row in batch) {
      _rev++;
      final values = Map<String, Object?>.of(row.values)
        ..['updated_at'] = _rev * 1000;
      _rows['${row.table}:${row.id}'] = _Stored(
        row.table,
        row.id,
        _rev,
        values,
      );
    }
  }

  /// Perapian harian Worker, dipadu kata demi kata: catat rev tombstone
  /// tertinggi yang akan dibuang, baru buang — semuanya satu kali jalan.
  void compact({required int olderThanRev}) {
    var bumped = 0;
    final doomed = <String>[];
    for (final entry in _rows.entries) {
      final row = entry.value;
      if (row.values['deleted'] == 1 && row.rev <= olderThanRev) {
        doomed.add(entry.key);
        if (row.rev > bumped) bumped = row.rev;
      }
    }
    if (doomed.isEmpty) return;
    _floor = bumped;
    for (final key in doomed) {
      _rows.remove(key);
    }
  }

  PullPage since(int sinceRev, int limit, {bool resync = false}) {
    // Persis `planPull`: yang tertinggal di bawah floor dijawab 409, kecuali
    // kalau pengirimnya sedang memulihkan diri — dan permintaan sejarah penuh
    // (rev nol) tidak pernah ikut ditolak, karena justru itulah obatnya.
    if (!resync && sinceRev > 0 && sinceRev < _floor) {
      throw const ResyncRequired();
    }
    final above = _rows.values.where((row) => row.rev > sinceRev).toList()
      ..sort((a, b) => a.rev.compareTo(b.rev));
    final page = [
      for (final row in above.take(limit))
        PullRow(
          table: row.table,
          id: row.id,
          rev: row.rev,
          values: Map<String, Object?>.of(row.values),
        ),
    ];
    var nextRev = sinceRev;
    for (final row in page) {
      nextRev = row.rev;
    }
    final hasMore = above.length > page.length;
    // Halaman terakhir dari sejarah yang lengkap menaikkan kursor ke floor:
    // tanpa itu hp yang baru pulih akan diminta pulih lagi, selamanya.
    if (!hasMore && nextRev < _floor) nextRev = _floor;
    return PullPage(rows: page, nextRev: nextRev, hasMore: hasMore);
  }
}

/// Jembatan hp ke model server, lengkap dengan tombol rusak.
class _Bridge implements SyncTransport {
  _Bridge(this.server);

  final _Server server;

  /// Baris per halaman unduhan; null berarti ikut permintaan klien.
  int? pageSize;

  /// Setelah berapa minta unduhan berhasil, sambungan dianggap mati.
  int? failPullAfter;

  bool failNextPush = false;
  bool alwaysResync = false;
  int pullCalls = 0;

  /// Pintu untuk menyimulasikan pengguna yang menulis sambil sesi berjalan —
  /// satu-satunya cara sebuah baris bisa berstatus `dirty` pada saat unduhan
  /// sedang dibacakan.
  Future<void> Function()? onPull;

  @override
  Future<void> push(List<PushRow> rows) async {
    if (failNextPush) {
      failNextPush = false;
      throw const _Offline();
    }
    server.accept(rows);
  }

  @override
  Future<PullPage> pull({
    required int sinceRev,
    required bool resync,
    int limit = 500,
  }) async {
    pullCalls++;
    if (failPullAfter != null && pullCalls > failPullAfter!) {
      throw const _Offline();
    }
    if (alwaysResync) throw const ResyncRequired();
    final page = server.since(sinceRev, pageSize ?? limit, resync: resync);
    // Cuma halaman sungguhan yang membuka pintu ini: permintaan yang ditolak
    // 409 tidak sedang menulis apa pun ke hp.
    if (onPull != null) await onPull!();
    return page;
  }
}

/// Satu hp nyata: SQLite sungguhan di berkas sementara, seperti di db_test.
class _Phone {
  _Phone({
    required this.db,
    required this.businessId,
    required this.deviceId,
    required this.bridge,
  });

  final Database db;
  final String businessId;
  final String deviceId;
  final _Bridge bridge;

  late final SyncSession session = SyncSession(
    db: db,
    outbox: Outbox(db),
    transport: bridge,
  );

  LedgerRepository get ledger => LedgerRepository(db, deviceId: deviceId);

  MasterRepository get master => MasterRepository(db, deviceId: deviceId);
}

final _dirs = <Directory>[];

Future<_Phone> openPhone(_Server server, String businessId) async {
  final dir = await Directory.systemTemp.createTemp('karsa-sync-test');
  _dirs.add(dir);
  final db = await KarsaDatabase.open(path: '${dir.path}/buku.db');
  addTearDown(db.close);
  final deviceId = await KarsaDatabase.ensureDeviceId(db);
  await createBusiness(
    db,
    name: 'Warung Kamu',
    deviceId: deviceId,
    id: businessId,
  );
  return _Phone(
    db: db,
    businessId: businessId,
    deviceId: deviceId,
    bridge: _Bridge(server),
  );
}

/// Isi bisnis sebuah hp. Cap waktu, `device_id` dan `dirty` dibuang: yang
/// dibandingkan adalah catatan pengguna, bukan buku besar tiap perangkat.
Future<Map<String, Set<String>>> snapshotOf(Database db) async {
  final out = <String, Set<String>>{};
  for (final table in DbSchema.syncableTables) {
    final rows = await db.query(table, orderBy: 'id');
    out[table] = {for (final row in rows) _fingerprint(table, row)};
  }
  return out;
}

String _fingerprint(String table, Map<String, Object?> row) {
  final wire = SyncProtocol.toWire(table, row)
    ..remove('created_at')
    ..remove('updated_at')
    ..remove('device_id');
  final keys = wire.keys.toList()..sort();
  final body = [for (final key in keys) '$key=${wire[key]}'].join(';');
  return '${row['id']}|$body';
}

Future<int> countOf(Database db, String table) async {
  final rows = await db.query(table, columns: ['id']);
  return rows.length;
}

LedgerEntry _entry(String id, PostRequest request) {
  return LedgerEngine.entry(
    id: id,
    date: DateTime(2026, 9, 1),
    request: request,
  );
}

const PostRequest modal = PostRequest(
  kind: EntryKind.modalAwal,
  amount: Money(300000),
);

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  tearDown(() async {
    for (final dir in _dirs) {
      await dir.delete(recursive: true);
    }
    _dirs.clear();
  });

  group('dua perangkat satu pemilik', () {
    test('catatan dari kedua hp bertemu di kedua sisi', () async {
      final server = _Server();
      final a = await openPhone(server, 'usaha-bersama');
      final rina = await a.master.saveParty(
        businessId: a.businessId,
        name: 'Rina',
      );
      await a.ledger.record(
        businessId: a.businessId,
        entry: _entry('modal-a', modal),
      );
      await a.session.run();

      // Hp kedua mengambil Rina lebih dulu: jurnal tidak boleh menunjuk pihak
      // yang belum ada di perangkat ini.
      final b = await openPhone(server, 'usaha-bersama');
      await b.session.run();
      await b.master.saveParty(businessId: b.businessId, name: 'Joko');
      await b.ledger.record(
        businessId: b.businessId,
        entry: _entry(
          'jualan-b',
          PostRequest(
            kind: EntryKind.penjualanKredit,
            amount: Money(25000),
            partyId: rina.id,
          ),
        ),
      );
      await b.session.run();
      await a.session.run();

      for (final phone in [a, b]) {
        expect(
          await countOf(phone.db, DbSchema.tableParty),
          2,
          reason: 'Rina dan Joko ada di dua hp',
        );
        expect(await countOf(phone.db, DbSchema.tableEntry), 2);
        expect(await countOf(phone.db, DbSchema.tableLine), 4);
      }
      expect(await snapshotOf(b.db), await snapshotOf(a.db));
    });

    test('akun semai tidak menjadi dua karena id-nya diturunkan', () async {
      final server = _Server();
      final a = await openPhone(server, 'usaha-bersama');
      final b = await openPhone(server, 'usaha-bersama');

      await a.session.run();
      await b.session.run();
      await a.session.run();

      for (final phone in [a, b]) {
        expect(
          await countOf(phone.db, DbSchema.tableAccount),
          ChartOfAccounts.seed.length,
          reason: 'dua perangkat menaburi bagan akun yang sama',
        );
      }
      expect(await snapshotOf(b.db), await snapshotOf(a.db));
    });

    test('jurnal naik bersama kepalanya dan turun utuh', () async {
      final server = _Server();
      final a = await openPhone(server, 'usaha-bersama');
      await a.ledger.record(
        businessId: a.businessId,
        entry: _entry('modal-a', modal),
      );
      await a.session.run();

      final b = await openPhone(server, 'usaha-bersama');
      await b.session.run();

      expect(await countOf(b.db, DbSchema.tableBusiness), 1);
      expect(await countOf(b.db, DbSchema.tableEntry), 1);
      expect(await countOf(b.db, DbSchema.tableLine), 2);
    });
  });

  group('urutan tiba menentukan pemenang', () {
    test('suntingan terakhir yang sampai menang di semua sisi', () async {
      final server = _Server();
      final a = await openPhone(server, 'usaha-bersama');
      final rina = await a.master.saveParty(
        businessId: a.businessId,
        name: 'Rina',
      );
      await a.session.run();

      final b = await openPhone(server, 'usaha-bersama');
      await b.session.run();
      await b.master.saveParty(
        id: rina.id,
        businessId: b.businessId,
        name: 'versi B',
      );
      await b.session.run();

      // A menyunting belakangan, jadi versinya yang berdiri setelah ini.
      await a.master.saveParty(
        id: rina.id,
        businessId: a.businessId,
        name: 'versi A',
      );
      await a.session.run();
      await b.session.run();

      for (final phone in [a, b]) {
        final names = (await phone.master.parties(phone.businessId))
            .map((party) => party.name)
            .toList();
        expect(names, contains('versi A'), reason: phone.deviceId);
        expect(names, isNot(contains('versi B')));
      }
    });
  });

  group('mati di tengah jalan', () {
    test('push yang gagal tidak menghapus antrean', () async {
      final server = _Server();
      final a = await openPhone(server, 'usaha-bersama');
      await a.master.saveParty(businessId: a.businessId, name: 'Rina');

      final outbox = Outbox(a.db);
      final waiting = await outbox.pendingCount();
      expect(waiting, greaterThan(0));

      a.bridge.failNextPush = true;
      await expectLater(a.session.run(), throwsA(isA<_Offline>()));
      expect(await outbox.pendingCount(), waiting);
      expect(server.head, 0);

      final report = await a.session.run();
      expect(report.pushed, waiting);
      expect(await outbox.pendingCount(), 0);
      expect(await countOf(a.db, DbSchema.tableParty), 1);
    });

    test('hasil akhir sama walau unduannya dipotong di tengah', () async {
      final server = _Server();
      final sumber = await openPhone(server, 'usaha-bersama');
      for (var i = 0; i < 6; i++) {
        await sumber.master.saveParty(
          businessId: sumber.businessId,
          name: 'pihak-$i',
        );
      }
      await sumber.session.run();

      final utuh = await openPhone(server, 'usaha-bersama');
      await utuh.session.run();

      // Perangkat yang sama sekali baru, tapi sambungannya mati di halaman
      // kedua: baris yang sudah masuk ikut menaikkan kursor karena keduanya
      // satu transaksi.
      final putus = await openPhone(server, 'usaha-bersama');
      putus.bridge.pageSize = 2;
      putus.bridge.failPullAfter = 2;
      await expectLater(putus.session.run(), throwsA(isA<_Offline>()));

      final cursor = await putus.session.cursor();
      expect(cursor, greaterThan(0));
      expect(cursor, lessThan(server.head));

      putus.bridge.pageSize = null;
      putus.bridge.failPullAfter = null;
      await putus.session.run();

      expect(await putus.session.cursor(), server.head);
      expect(await countOf(putus.db, DbSchema.tableParty), 6);
      expect(await snapshotOf(putus.db), await snapshotOf(utuh.db));
    });
  });

  group('sejarah yang sudah diringkas', () {
    /// Tinggalkan satu hp tanpa tersinkron, sementara hp lain menghapus sebuah
    /// pihak dan perapian ikut membuang tombstone penghapusan itu. Yang punya
    /// hp tertinggal tidak akan pernah melihat penghapusannya lagi: server cuma
    /// bisa mengembalikan daftar yang masih hidup.
    Future<({int tombstone, _Phone stale})> leaveOnePhoneBehind() async {
      final server = _Server();
      final a = await openPhone(server, 'usaha-bersama');
      final rina = await a.master.saveParty(
        businessId: a.businessId,
        name: 'Rina',
      );
      await a.master.saveParty(businessId: a.businessId, name: 'Joko');
      await a.session.run();

      // Hp kedua sempat melihat keduanya masih hidup. Itulah yang membuat
      // penghapusan nanti bisa hilang dari kursornya, bukan dari catatannya.
      final stale = await openPhone(server, 'usaha-bersama');
      await stale.session.run();

      await a.master.deleteParty(rina.id);
      await a.session.run();
      final tombstone = server.head;
      server.compact(olderThanRev: tombstone);
      expect(
        server.floor,
        tombstone,
        reason: 'floor = rev tombstone yang baru saja dibuang',
      );
      return (tombstone: tombstone, stale: stale);
    }

    test('hp yang tertinggal pulih sendiri jadi sejarah penuh', () async {
      final seeded = await leaveOnePhoneBehind();
      final b = seeded.stale;
      final rinaId = (await b.db.query(
        DbSchema.tableParty,
        columns: ['id'],
        where: 'name = ?',
        whereArgs: ['Rina'],
      )).single['id'] as String;

      await b.session.run();

      expect(await b.session.cursor(), b.bridge.server.head);
      final names = (await b.master.parties(b.businessId))
          .map((party) => party.name)
          .toList();
      expect(names, contains('Joko'));
      expect(
        names,
        isNot(contains('Rina')),
        reason: 'penghapusannya ikut pulih',
      );

      // Bukan hapus fisik: barisnya masih di hp, cuma dinyatakan terhapus.
      final raw = await b.db.query(
        DbSchema.tableParty,
        where: 'id = ?',
        whereArgs: [rinaId],
      );
      expect(raw.single['deleted'], 1);
      expect(raw.single['dirty'], 0, reason: 'kesimpulan lokal, bukan klaim');
    });

    test('hp yang sudah pulih tidak menarik ulang sejarahnya', () async {
      final seeded = await leaveOnePhoneBehind();
      final b = seeded.stale;
      await b.session.run();
      expect(
        await b.session.cursor(),
        greaterThanOrEqualTo(b.bridge.server.floor),
      );

      // Inilah harga dari menaikkan kursor ke floor: sesi berikutnya minta
      // delta biasa. Tanpa itu, setiap sesi menarik sejarah penuh dari awal dan
      // "pulih" tidak pernah benar-benar selesai.
      b.bridge.pullCalls = 0;
      await b.session.run();
      expect(b.bridge.pullCalls, 1);
      expect(await b.session.cursor(), b.bridge.server.head);
      expect(
        await KarsaDatabase.metaValue(b.db, kMetaResyncing),
        '0',
        reason: 'penanda unduh ulang dilepas sekali sejarah selesai dibaca',
      );
    });

    test('catatan yang belum sampai tidak ikut dipensiunkan', () async {
      final seeded = await leaveOnePhoneBehind();
      final b = seeded.stale;

      // Sejarah datang sebaris-sebaris; di tengah itu pengguna menulis.
      var wrote = false;
      b.bridge.pageSize = 1;
      b.bridge.onPull = () async {
        if (wrote) return;
        wrote = true;
        await b.master.saveParty(businessId: b.businessId, name: 'Siti');
      };
      await b.session.run();
      b.bridge.onPull = null;
      b.bridge.pageSize = null;

      final siti = await b.db.query(
        DbSchema.tableParty,
        where: 'name = ?',
        whereArgs: ['Siti'],
      );
      expect(
        siti.single['deleted'],
        0,
        reason: 'punya pengguna, belum pernah diakui server',
      );
      expect(siti.single['dirty'], 1);

      await b.session.run();
      final pending = await b.db.query(
        DbSchema.tableParty,
        columns: ['id'],
        where: 'dirty = 1',
      );
      expect(pending, isEmpty);
      expect(
        (await b.master.parties(b.businessId)).map((party) => party.name),
        containsAll(<String>['Joko', 'Siti']),
      );
      expect(b.bridge.server.head, greaterThan(seeded.tombstone));
    });

    test('unduh ulang yang terpotong tidak membuang catatan apa pun', () async {
      final seeded = await leaveOnePhoneBehind();
      final b = seeded.stale;

      // Sambungan mati di halaman kedua sejarah penuh: 409, satu baris hidup,
      // lalu diam. Yang belum sempat datang tidak bisa dinyatakan hilang.
      b.bridge.pullCalls = 0;
      b.bridge.pageSize = 1;
      b.bridge.failPullAfter = 2;
      await expectLater(b.session.run(), throwsA(isA<_Offline>()));
      b.bridge.pageSize = null;
      b.bridge.failPullAfter = null;

      final rina = await b.db.query(
        DbSchema.tableParty,
        columns: ['deleted'],
        where: 'name = ?',
        whereArgs: ['Rina'],
      );
      expect(
        rina.single['deleted'],
        0,
        reason: 'sebagian sejarah bukan bukti bahwa sebuah baris tidak ada',
      );
      expect(
        await KarsaDatabase.metaValue(b.db, kMetaResyncing),
        '1',
        reason: 'hp ini tahu daftarnya belum selesai',
      );

      // Baru setelah sejarah itu terbaca penuh kesimpulan lokal boleh datang.
      await b.session.run();
      final healed = await b.db.query(
        DbSchema.tableParty,
        columns: ['deleted'],
        where: 'name = ?',
        whereArgs: ['Rina'],
      );
      expect(healed.single['deleted'], 1);
      expect(b.bridge.server.floor, seeded.tombstone);

      // Joko sudah masuk pada pembacaan yang terpotong. Sesi penutup membacanya
      // ulang dari nol justru supaya ia tidak dianggap hilang oleh daftar yang
      // dimulai dari tengah.
      final joko = await b.db.query(
        DbSchema.tableParty,
        columns: ['deleted'],
        where: 'name = ?',
        whereArgs: ['Joko'],
      );
      expect(joko.single['deleted'], 0);
    });

    test('409 pada sejarah penuh berhenti, tidak berputar selamanya', () async {
      final server = _Server();
      final a = await openPhone(server, 'usaha-bersama');
      await a.session.run();
      expect(await a.session.cursor(), greaterThan(0));

      final outbox = Outbox(a.db);
      a.bridge.pullCalls = 0;
      a.bridge.alwaysResync = true;
      await expectLater(a.session.run(), throwsA(isA<ResyncRequired>()));

      // Satu minta pada kursor lama, satu lagi sesudah kursor nol. Tidak ada
      // putaran ketiga: 409 pada sejarah penuh berarti servernya yang salah,
      // dan itu harus terdengar, bukan diam-diam diulang selamanya.
      expect(a.bridge.pullCalls, 2);
      expect(await a.session.cursor(), 0);
      expect(await outbox.pendingCount(), 0);
    });
  });
}

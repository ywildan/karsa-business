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

  int get head => _rev;

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

  List<PullRow> since(int sinceRev, int limit) {
    final ready = _rows.values.where((row) => row.rev > sinceRev).toList()
      ..sort((a, b) => a.rev.compareTo(b.rev));
    return [
      for (final row in ready.take(limit))
        PullRow(
          table: row.table,
          id: row.id,
          rev: row.rev,
          values: Map<String, Object?>.of(row.values),
        ),
    ];
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
  int pullCalls = 0;

  @override
  Future<void> push(List<PushRow> rows) async {
    if (failNextPush) {
      failNextPush = false;
      throw const _Offline();
    }
    server.accept(rows);
  }

  @override
  Future<List<PullRow>> pull({required int sinceRev, int limit = 500}) async {
    pullCalls++;
    if (failPullAfter != null && pullCalls > failPullAfter!) {
      throw const _Offline();
    }
    return server.since(sinceRev, pageSize ?? limit);
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

  late final SyncSession session =
      SyncSession(db: db, outbox: Outbox(db), transport: bridge);

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
}

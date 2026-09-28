import 'package:flutter_test/flutter_test.dart';
import 'package:karsa_business/data/db.dart';
import 'package:karsa_business/data/outbox.dart';
import 'package:karsa_business/domain/sync_protocol.dart';

/// Baris dari server untuk tabel [table], dengan cap `updated_at` ikut rev.
PullRow _row(
  String table,
  String id, {
  required int rev,
  Map<String, Object?> values = const {},
}) {
  return PullRow(
    table: table,
    id: id,
    rev: rev,
    values: {'id': id, 'updated_at': rev * 1000, ...values},
  );
}

String _key(String table, String id) => '$table:$id';

/// Hp palsu tempat aturan diterapkan, supaya jalur sinkron bisa diuji tanpa
/// basis data dan tanpa jaringan.
class _Phone {
  final Map<String, Map<String, Object?>> rows = {};
  int cursor = 0;

  /// Menerima satu halaman unduhan. [stopAfter] mensimulasikan proses dibunuh
  /// tepat sesudah baris ber-id itu tersimpan: tulis lokal dan naiknya kursor
  /// ada dalam satu transaksi, jadi keduanya terjadi bersamaan atau tidak
  /// sama sekali.
  void pull(List<PullRow> page, {Set<String> stopAfter = const {}}) {
    final applied = <PullRow>[];
    for (final row in SyncProtocol.orderForApply(page)) {
      final existing = rows[row.key];
      if (SyncProtocol.decide(
            localKnown: existing != null,
            localDirty: existing != null && existing['dirty'] == 1,
          ) ==
          PullOutcome.keepLocal) {
        continue;
      }
      rows[row.key] = SyncProtocol.localWrite(row);
      applied.add(row);
      if (stopAfter.contains(row.id)) break;
    }
    cursor = SyncProtocol.watermark(applied, notKnown: cursor);
  }

  /// Isi satu kolom dari baris yang sudah turun di hp ini.
  Object? column(String table, String id, String name) =>
      rows[_key(table, id)]?[name];
}

/// Kolom yang benar-benar ada di DDL, dibaca dari skema itu sendiri.
Map<String, List<String>> _columnsFromSchema() {
  final found = <String, List<String>>{};
  for (final statement in DbSchema.statements) {
    if (!statement.startsWith('CREATE TABLE ')) continue;
    final open = statement.indexOf('(');
    final close = statement.lastIndexOf(')');
    final name = statement.substring('CREATE TABLE '.length, open).trim();
    if (!DbSchema.syncableTables.contains(name)) continue;
    final columns = <String>[];
    for (final raw in statement.substring(open + 1, close).split('\n')) {
      final line = raw.trim();
      if (line.startsWith('UNIQUE') ||
          line.startsWith('CHECK') ||
          line.startsWith('PRIMARY') ||
          line.startsWith('FOREIGN')) {
        continue;
      }
      // Baris kosong dan koma telanjang hasil `$_syncColumns,` di akhir daftar.
      final first = line.split(RegExp(r'\s')).first.replaceAll(',', '');
      if (!RegExp(r'^[a-z_]+$').hasMatch(first)) continue;
      columns.add(first);
    }
    found[name] = columns;
  }
  return found;
}

void main() {
  group('isi kiriman naik', () {
    test('kolom dalam hp tidak ikut naik', () {
      expect(
        SyncProtocol.toWire(DbSchema.tableBusiness, {
          'id': 'b1',
          'name': 'Warung Kamu',
          'dirty': 1,
        }),
        {'id': 'b1', 'name': 'Warung Kamu'},
      );
    });

    test('rev dan owner_id milik server tidak pernah dikirim', () {
      final wire = SyncProtocol.toWire(DbSchema.tableParty, {
        'id': 'p1',
        'business_id': 'b1',
        'name': 'Rina',
        'rev': 17,
        'owner_id': 'sipemilik',
      });
      expect(wire.containsKey('rev'), isFalse);
      expect(wire.containsKey('owner_id'), isFalse);
    });

    test('kolom yang bukan milik tabel dibuang', () {
      final wire = SyncProtocol.toWire(DbSchema.tableAccount, {
        'id': 'a1',
        'business_id': 'b1',
        'code': '1100',
        'name': 'Kas',
        'debit': 50000,
      });
      expect(wire.containsKey('debit'), isFalse);
      expect(wire['code'], '1100');
    });

    test('id buatan perangkat dipertahankan apa adanya', () {
      final wire = SyncProtocol.toWire(DbSchema.tableParty, {
        'id': 'id-dari-hp-ini',
        'business_id': 'b1',
        'name': 'Rina',
      });
      expect(wire['id'], 'id-dari-hp-ini');
    });

    test('tabel yang tidak ikut sinkron ditolak dengan suara', () {
      expect(
        () => SyncProtocol.toWire(DbSchema.tableMeta, {'key': 'device_id'}),
        throwsArgumentError,
      );
    });
  });

  group('keputusan satu baris yang datang', () {
    test('baris yang belum ada di hp selalu diterapkan', () {
      expect(
        SyncProtocol.decide(localKnown: false, localDirty: false),
        PullOutcome.apply,
      );
    });

    test('catatan yang belum sempat naik tidak ditimpa unduhan', () {
      expect(
        SyncProtocol.decide(localKnown: true, localDirty: true),
        PullOutcome.keepLocal,
      );
    });

    test('baris yang sudah diakui server boleh ditulis ulang', () {
      expect(
        SyncProtocol.decide(localKnown: true, localDirty: false),
        PullOutcome.apply,
      );
    });
  });

  group('urutan penerapan', () {
    test('dua versi baris sama, rev terbesar yang menang', () {
      final ordered = SyncProtocol.orderForApply([
        _row(DbSchema.tableItem, 'i1', rev: 9, values: {'name': 'lama'}),
        _row(DbSchema.tableItem, 'i1', rev: 12, values: {'name': 'baru'}),
      ]);
      expect(ordered, hasLength(1));
      expect(ordered.single.rev, 12);
    });

    test('urutan keluar tidak tergantung urutan masuk', () {
      final page = [
        _row(DbSchema.tableItem, 'i1', rev: 10),
        _row(DbSchema.tableItem, 'i2', rev: 20),
        _row(DbSchema.tableItem, 'i3', rev: 30),
      ];
      expect(
        SyncProtocol.orderForApply(page.reversed).map((r) => r.rev).toList(),
        [10, 20, 30],
      );
    });

    test('jam perangkat yang mundur tidak mengubah urutan', () {
      // Baris ini dibuat dengan jam hp yang salah (mundur seminggu) tetapi
      // server yang men-stempel rev dan updated_at saat ia tiba.
      final page = [
        _row(DbSchema.tableParty, 'p-baru', rev: 40, values: {'name': 'Baru'}),
        _row(DbSchema.tableParty, 'p-lama', rev: 41, values: {'name': 'Lama'}),
      ];
      final phone = _Phone()..pull(page);
      expect(phone.cursor, 41);
      expect(phone.column(DbSchema.tableParty, 'p-lama', 'updated_at'), 41000);
    });

    test('dua perangkat, dua id berbeda, keduanya sampai', () {
      final phone = _Phone()
        ..pull([
          _row(DbSchema.tableParty, 'dari-hp-a', rev: 4),
          _row(DbSchema.tableParty, 'dari-hp-b', rev: 5),
        ]);
      expect(
        phone.rows.keys,
        containsAll(<String>[
          _key(DbSchema.tableParty, 'dari-hp-a'),
          _key(DbSchema.tableParty, 'dari-hp-b'),
        ]),
      );
    });

    test('baris yang ditahan tidak menaikkan kursor', () {
      final phone = _Phone();
      phone.rows[_key(DbSchema.tableParty, 'p1')] = {'id': 'p1', 'dirty': 1};
      phone.pull([_row(DbSchema.tableParty, 'p1', rev: 6)]);
      // Bukan macet: push atas baris ini membuat server men-stempel ulang
      // dengan rev yang lebih besar, dan halaman berikutnya maju lagi.
      expect(phone.cursor, 0);
      expect(phone.column(DbSchema.tableParty, 'p1', 'dirty'), 1);
    });
  });

  group('kursor unduhan', () {
    test('halaman kosong membuat kursor diam di tempat', () {
      expect(SyncProtocol.watermark(const [], notKnown: 77), 77);
    });

    test('kursor tidak pernah mundur walau rev datang terbalik', () {
      final applied = [
        _row(DbSchema.tableItem, 'i1', rev: 120),
        _row(DbSchema.tableItem, 'i2', rev: 90),
      ];
      expect(SyncProtocol.watermark(applied, notKnown: 80), 120);
    });
  });

  group('tombstone', () {
    test('penghapusan dari perangkat lain ikut diterapkan', () {
      final masuk = _row(
        DbSchema.tableParty,
        'p1',
        rev: 1,
        values: {'name': 'Rina'},
      );
      final hapus = _row(
        DbSchema.tableParty,
        'p1',
        rev: 2,
        values: {'deleted': 1},
      );
      final phone = _Phone()
        ..pull([masuk])
        ..pull([hapus]);
      expect(phone.column(DbSchema.tableParty, 'p1', 'deleted'), 1);
    });

    test('penghapusan lokal yang belum naik tidak dibatalkan unduhan', () {
      final phone = _Phone();
      phone.rows[_key(DbSchema.tableParty, 'p1')] = {
        'id': 'p1',
        'deleted': 1,
        'dirty': 1,
      };
      phone.pull([_row(DbSchema.tableParty, 'p1', rev: 2)]);
      expect(phone.column(DbSchema.tableParty, 'p1', 'deleted'), 1);
      expect(phone.column(DbSchema.tableParty, 'p1', 'dirty'), 1);
    });
  });

  group('isi tulisan lokal', () {
    test('dirty dimatikan dan cap server dipakai apa adanya', () {
      final values = SyncProtocol.localWrite(
        _row(
          DbSchema.tableItem,
          'i1',
          rev: 8,
          values: {'name': 'Beras', 'device_id': 'hp-lain'},
        ),
      );
      expect(values['dirty'], 0);
      expect(values['updated_at'], 8000);
      expect(values['device_id'], 'hp-lain');
      expect(values.containsKey('rev'), isFalse);
    });

    test('kolom asing di balasan server diabaikan', () {
      final values = SyncProtocol.localWrite(
        _row(
          DbSchema.tableItem,
          'i1',
          rev: 8,
          values: {'name': 'Beras', 'owner_id': 'pemilik', 'aneh': 'x'},
        ),
      );
      expect(values.containsKey('owner_id'), isFalse);
      expect(values.containsKey('aneh'), isFalse);
    });
  });

  group('bertahan mati di tengah jalan', () {
    final page = [
      _row(DbSchema.tableItem, 'i1', rev: 10, values: {'name': 'Beras'}),
      _row(DbSchema.tableItem, 'i2', rev: 20, values: {'name': 'Gula'}),
      _row(DbSchema.tableItem, 'i3', rev: 30, values: {'name': 'Minyak'}),
      _row(DbSchema.tableItem, 'i4', rev: 40, values: {'name': 'Telur'}),
      _row(DbSchema.tableItem, 'i5', rev: 50, values: {'name': 'Kopi'}),
    ];

    test('dibunuh sesudah baris ketiga menghasilkan buku yang sama', () {
      final utuh = _Phone()..pull(page);
      final mati = _Phone()..pull(page, stopAfter: {'i3'});
      expect(mati.rows, hasLength(3));
      expect(mati.cursor, 30);
      mati.pull(page.where((row) => row.rev > mati.cursor).toList());
      expect(mati.rows, utuh.rows);
      expect(mati.cursor, utuh.cursor);
    });

    test('halaman yang sama diterapkan dua kali tidak mengubah apa pun', () {
      final sekali = _Phone()..pull(page);
      final duaKali = _Phone()
        ..pull(page)
        ..pull(page);
      expect(duaKali.rows, sekali.rows);
      expect(duaKali.cursor, sekali.cursor);
    });

    test('tiga minggu offline ditarik bertahap tanpa kursor melompat', () {
      final semua = [
        for (var i = 1; i <= 1200; i++)
          _row(
            DbSchema.tableEntry,
            'e$i',
            rev: i,
            values: {'kind': 'penjualan'},
          ),
      ];
      final phone = _Phone();
      var halaman = 0;
      while (phone.rows.length < semua.length) {
        final batch = semua
            .where((row) => row.rev > phone.cursor)
            .take(SyncProtocol.pullPage)
            .toList();
        phone.pull(batch);
        halaman++;
      }
      expect(halaman, (1200 / SyncProtocol.pullPage).ceil());
      expect(phone.cursor, 1200);
      expect(phone.rows, hasLength(1200));
    });
  });

  group('skema dan protokol tidak boleh bergeser', () {
    test('tabel yang ikut sinkron adalah tabel yang sama', () {
      expect(
        SyncProtocol.wireColumns.keys.toSet(),
        DbSchema.syncableTables.toSet(),
      );
    });

    test('kolom kiriman persis kolom DDL kurang dirty', () {
      final ddl = _columnsFromSchema();
      expect(ddl, hasLength(DbSchema.syncableTables.length));
      for (final table in DbSchema.syncableTables) {
        final bolehNaik = {
          ...SyncProtocol.wireColumns[table]!,
          ...SyncProtocol.stampedColumns,
          'dirty',
        };
        expect(ddl[table], hasLength(bolehNaik.length), reason: table);
        expect(ddl[table]!.toSet(), bolehNaik, reason: table);
      }
    });

    test('kolom milik server tidak pernah masuk daftar kiriman', () {
      for (final columns in SyncProtocol.wireColumns.values) {
        expect(columns.toSet().intersection(SyncProtocol.serverOwned), isEmpty);
        expect(columns, isNot(contains('dirty')));
      }
    });

    test('induk yang dibawa outbox dikenal server dan kolomnya ikut naik', () {
      for (final entry in syncParents.entries) {
        expect(DbSchema.syncableTables, contains(entry.key), reason: entry.key);
        for (final ref in entry.value) {
          expect(
            DbSchema.syncableTables,
            contains(ref.table),
            reason: '${entry.key}.${ref.column}',
          );
          expect(
            SyncProtocol.wireColumns[entry.key],
            contains(ref.column),
            reason: '${entry.key}.${ref.column}',
          );
        }
      }
    });

    test('business tidak punya induk', () {
      expect(syncParents.containsKey(DbSchema.tableBusiness), isFalse);
    });
  });
}

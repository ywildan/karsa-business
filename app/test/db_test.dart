import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:karsa_business/core/money.dart';
import 'package:karsa_business/data/db.dart';
import 'package:karsa_business/data/ledger_repository.dart';
import 'package:karsa_business/data/master_repository.dart';
import 'package:karsa_business/data/outbox.dart';
import 'package:karsa_business/domain/account.dart';
import 'package:karsa_business/domain/ledger.dart';
import 'package:karsa_business/domain/ledger_engine.dart';
import 'package:karsa_business/domain/reports.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Buku yang sudah dibuka, beserta usaha dan identitas perangkat di dalamnya.
class Book {
  Book(this.db, this.businessId, this.deviceId);

  final Database db;
  final String businessId;
  final String deviceId;

  LedgerRepository get ledger => LedgerRepository(db, deviceId: deviceId);

  MasterRepository get master => MasterRepository(db, deviceId: deviceId);

  Outbox get outbox => Outbox(db);
}

Future<Book> openBook() async {
  final db = await KarsaDatabase.open(path: inMemoryDatabasePath);
  final deviceId = await KarsaDatabase.ensureDeviceId(db);
  final businessId = await createBusiness(
    db,
    name: 'Warung Kamu',
    deviceId: deviceId,
  );
  return Book(db, businessId, deviceId);
}

/// Entri seperti yang akan dibangun layar: maksud dulu, baru jurnalnya.
LedgerEntry post(String id, DateTime date, PostRequest request) =>
    LedgerEngine.entry(id: id, date: date, request: request);

const PostRequest modal = PostRequest(
  kind: EntryKind.modalAwal,
  amount: Money(300000),
);

Future<List<Map<String, Object?>>> rowsOf(
  Database db,
  String table, {
  String where = '1 = 1',
  List<Object?>? args,
}) => db.query(table, where: where, whereArgs: args, orderBy: 'id');

Future<int> countOf(
  Database db,
  String table, {
  String where = '1 = 1',
  List<Object?>? args,
}) async {
  final rows = await db.query(
    table,
    columns: ['id'],
    where: where,
    whereArgs: args,
    limit: 1000,
  );
  return rows.length;
}

Future<void> markPushed(Database db, String table, String id) => db.update(
  table,
  {'dirty': 0},
  where: 'id = ?',
  whereArgs: [id],
);

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  group('skema', () {
    test('semua tabel dan indeks dirty terbentuk', () async {
      final book = await openBook();
      addTearDown(book.db.close);

      final names = (await book.db.rawQuery(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      )).map((row) => row['name'] as String).toSet();
      expect(
        names,
        containsAll(<String>{...DbSchema.syncableTables, DbSchema.tableMeta}),
      );

      final indexes = (await book.db.rawQuery(
        "SELECT name FROM sqlite_master WHERE type = 'index'",
      )).map((row) => row['name'] as String).toSet();
      for (final table in DbSchema.syncableTables) {
        expect(indexes, contains('idx_${table}_dirty'));
      }
    });

    test('foreign key ditegakkan', () async {
      final book = await openBook();
      addTearDown(book.db.close);

      final pragma = await book.db.rawQuery('PRAGMA foreign_keys');
      expect(pragma.single.values.first, 1);

      await expectLater(
        book.db.insert(DbSchema.tableLine, {
          'id': 'yatim',
          'entry_id': 'tidak-ada',
          'business_id': book.businessId,
          'account_code': AccountCode.kas.code,
          'debit': 100,
          'credit': 0,
          'created_at': 1,
          'updated_at': 1,
          'deleted': 0,
          'dirty': 1,
          'device_id': book.deviceId,
        }),
        throwsA(isA<DatabaseException>()),
      );
    });

    test('satu sisi tidak boleh debit dan kredit sekaligus', () async {
      final book = await openBook();
      addTearDown(book.db.close);
      await book.ledger.record(
        businessId: book.businessId,
        entry: post('induk', DateTime(2026, 9, 1), modal),
      );

      await expectLater(
        book.db.insert(DbSchema.tableLine, {
          'id': 'serakah',
          'entry_id': 'induk',
          'business_id': book.businessId,
          'account_code': AccountCode.kas.code,
          'debit': 100,
          'credit': 100,
          'created_at': 1,
          'updated_at': 1,
          'deleted': 0,
          'dirty': 1,
          'device_id': book.deviceId,
        }),
        throwsA(isA<DatabaseException>()),
      );
      await expectLater(
        book.db.insert(DbSchema.tableLine, {
          'id': 'kosong',
          'entry_id': 'induk',
          'business_id': book.businessId,
          'account_code': AccountCode.kas.code,
          'debit': 0,
          'credit': 0,
          'created_at': 1,
          'updated_at': 1,
          'deleted': 0,
          'dirty': 1,
          'device_id': book.deviceId,
        }),
        throwsA(isA<DatabaseException>()),
      );
    });

    test('nomor akun hanya sekali per usaha', () async {
      final book = await openBook();
      addTearDown(book.db.close);

      await expectLater(
        book.db.insert(DbSchema.tableAccount, {
          'id': 'dobel',
          'business_id': book.businessId,
          'code': AccountCode.kas.code,
          'name': 'Kas dua',
          'created_at': 1,
          'updated_at': 1,
          'deleted': 0,
          'dirty': 1,
          'device_id': book.deviceId,
        }),
        throwsA(isA<DatabaseException>()),
      );
    });
  });

  group('semaian', () {
    test('usaha baru dapat sembilan pos, urut nomor dan jenisnya terbaca',
        () async {
      final book = await openBook();
      addTearDown(book.db.close);

      final accounts = await book.ledger.accounts(book.businessId);
      expect(
        accounts.map((account) => account.code).toList(),
        ChartOfAccounts.seedCodes,
      );
      expect(
        accounts.map((account) => account.name).toList(),
        [for (final account in ChartOfAccounts.seed) account.label],
      );
      expect(accounts.first.type, AccountType.asset);
    });

    test('id semaian diturunkan dari isinya, menabur ulang tidak menambah',
        () async {
      final book = await openBook();
      addTearDown(book.db.close);

      final kas = await rowsOf(
        book.db,
        DbSchema.tableAccount,
        where: 'code = ?',
        args: [AccountCode.kas.code],
      );
      expect(kas.single['id'], seededAccountId(book.businessId, '1100'));

      await seedAccounts(
        book.db,
        businessId: book.businessId,
        deviceId: book.deviceId,
      );
      expect(
        await countOf(book.db, DbSchema.tableAccount),
        ChartOfAccounts.seed.length,
      );
    });

    test('id perangkat stabil walau berkasnya dibuka lagi', () async {
      final dir = await Directory.systemTemp.createTemp('karsa-db-test');
      final path = '${dir.path}/buku.db';

      final first = await KarsaDatabase.open(path: path);
      final deviceId = await KarsaDatabase.ensureDeviceId(first);
      final businessId = await createBusiness(
        first,
        name: 'Warung Kamu',
        deviceId: deviceId,
      );
      await LedgerRepository(first, deviceId: deviceId).record(
        businessId: businessId,
        entry: post('modal-1', DateTime(2026, 9, 1), modal),
      );
      await first.close();

      final second = await KarsaDatabase.open(path: path);
      addTearDown(() async {
        await second.close();
        await dir.delete(recursive: true);
      });

      expect(await KarsaDatabase.ensureDeviceId(second), deviceId);
      final kept = await LedgerRepository(
        second,
        deviceId: deviceId,
      ).entries(businessId: businessId);
      expect(kept.single.id, 'modal-1');
      expect(kept.single.totalDebit, Money(300000));
    });
  });

  group('jurnal', () {
    test('tertulis dan terbaca kembali persis seperti objek domainnya',
        () async {
      final book = await openBook();
      addTearDown(book.db.close);
      final party = await book.master.saveParty(
        businessId: book.businessId,
        name: 'Rina',
      );

      final entry = post(
        'piutang-1',
        DateTime(2026, 9, 4, 17, 30),
        PostRequest(
          kind: EntryKind.penjualanKredit,
          amount: Money(25000),
          cost: Money(10000),
          description: 'Empat porsi',
          partyId: party.id,
        ),
      );
      await book.ledger.record(businessId: book.businessId, entry: entry);

      final loaded = await book.ledger.entries(businessId: book.businessId);
      expect(loaded.single.id, entry.id);
      expect(loaded.single.date, DateTime(2026, 9, 4));
      expect(loaded.single.kindCode, EntryKind.penjualanKredit.code);
      expect(loaded.single.description, 'Empat porsi');
      expect(loaded.single.partyId, party.id);
      expect(loaded.single.cashAccountCode, AccountCode.kas.code);
      // Sisinya dibaca urut nomor akun, bukan urut ketikan: yang penting
      // keempat sisi itu ada dan angkanya tidak berubah.
      expect(
        loaded.single.lines.map((line) => line.toString()).toList(),
        entry.lines.map((line) => line.toString()).toList()..sort(),
      );
      expect(Reports.trialBalanceBalances(loaded), isTrue);
    });

    test('rentang tanggal memotong di level penyimpanan', () async {
      final book = await openBook();
      addTearDown(book.db.close);

      await book.ledger.record(
        businessId: book.businessId,
        entry: post('a', DateTime(2026, 9, 1), modal),
      );
      await book.ledger.record(
        businessId: book.businessId,
        entry: post(
          'b',
          DateTime(2026, 9, 2),
          const PostRequest(
            kind: EntryKind.pengeluaran,
            amount: Money(5000),
            targetAccountCode: '6200',
          ),
        ),
      );

      expect(
        (await book.ledger.entries(
          businessId: book.businessId,
          from: DateTime(2026, 9, 2),
        )).map((entry) => entry.id).toList(),
        ['b'],
      );
      final headOfSeptember = await book.ledger.entries(
        businessId: book.businessId,
        to: DateTime(2026, 9, 1, 23, 59),
      );
      expect(headOfSeptember.map((entry) => entry.id).toList(), ['a']);
    });

    test('yang tidak seimbang ditolak sebelum menyentuh berkas', () async {
      final book = await openBook();
      addTearDown(book.db.close);

      await expectLater(
        book.ledger.record(
          businessId: book.businessId,
          entry: LedgerEntry(
            id: 'cacat',
            date: DateTime(2026, 9, 1),
            kindCode: EntryKind.pengeluaran.code,
            lines: const [
              LedgerLine(accountCode: '6200', debit: Money(5000)),
            ],
          ),
        ),
        throwsA(
          isA<LedgerException>().having(
            (error) => error.code,
            'code',
            'unbalanced_entry',
          ),
        ),
      );
      expect(await countOf(book.db, DbSchema.tableEntry), 0);
      expect(await countOf(book.db, DbSchema.tableLine), 0);
    });

    test('sisi yang belum pernah berangkat dihapus fisik saat diganti',
        () async {
      final book = await openBook();
      addTearDown(book.db.close);

      final original = post(
        'koreksi',
        DateTime(2026, 9, 3),
        const PostRequest(
          kind: EntryKind.pengeluaran,
          amount: Money(5000),
          targetAccountCode: '6200',
        ),
      );
      await book.ledger.record(businessId: book.businessId, entry: original);
      expect(
        await countOf(book.db, DbSchema.tableLine, where: 'deleted = 0'),
        2,
      );

      await book.ledger.replaceLines(
        businessId: book.businessId,
        entry: original.copyWith(
          lines: const [
            LedgerLine(accountCode: '6200', debit: Money(7000)),
            LedgerLine(accountCode: '1100', credit: Money(7000)),
          ],
        ),
      );

      expect(await countOf(book.db, DbSchema.tableLine), 2);
      final loaded = await book.ledger.entries(businessId: book.businessId);
      expect(loaded.single.totalDebit, Money(7000));
      expect(Reports.trialBalanceBalances(loaded), isTrue);
    });

    test('sisi yang sudah berangkat dikubur saat diganti', () async {
      final book = await openBook();
      addTearDown(book.db.close);

      final original = post(
        'tersinkron',
        DateTime(2026, 9, 3),
        const PostRequest(
          kind: EntryKind.pengeluaran,
          amount: Money(5000),
          targetAccountCode: '6200',
        ),
      );
      await book.ledger.record(businessId: book.businessId, entry: original);
      await book.outbox.confirm(await book.outbox.next());
      expect(await book.outbox.pendingCount(), 0);

      await book.ledger.replaceLines(
        businessId: book.businessId,
        entry: original.copyWith(
          lines: const [
            LedgerLine(accountCode: '6200', debit: Money(9000)),
            LedgerLine(accountCode: '1100', credit: Money(9000)),
          ],
        ),
      );

      expect(
        await countOf(book.db, DbSchema.tableLine, where: 'deleted = 1'),
        2,
      );
      final delta = await book.outbox.next();
      final graves = delta.where((row) => row.isTombstone).toList();
      expect(graves, hasLength(2));
      expect(graves.map((row) => row.table).toSet(), {DbSchema.tableLine});
      final loaded = await book.ledger.entries(businessId: book.businessId);
      expect(loaded.single.totalDebit, Money(9000));
      expect(Reports.trialBalanceBalances(loaded), isTrue);
    });

    test('menghapus transaksi ikut mengubur seluruh sisinya', () async {
      final book = await openBook();
      addTearDown(book.db.close);

      await book.ledger.record(
        businessId: book.businessId,
        entry: post(
          'dihapus',
          DateTime(2026, 9, 3),
          const PostRequest(
            kind: EntryKind.pemasukan,
            amount: Money(20000),
            targetAccountCode: '5900',
          ),
        ),
      );
      await book.outbox.confirm(await book.outbox.next());

      await book.ledger.deleteEntry('dihapus');
      expect(await book.ledger.entries(businessId: book.businessId), isEmpty);

      final delta = await book.outbox.next();
      final graves = delta.where((row) => row.isTombstone).toList();
      expect(graves, hasLength(3));
      expect(
        graves.map((row) => row.table).toSet(),
        {DbSchema.tableEntry, DbSchema.tableLine},
      );
      // Usaha kepala jurnal itu ikut naik walau tidak berubah, supaya server
      // punya tempat untuk menautkan barisnya.
      expect(
        delta.firstWhere((row) => row.carried).table,
        DbSchema.tableBusiness,
      );
    });
  });

  group('outbox', () {
    test('menangkap semua yang berubah lalu diam setelah dikonfirmasi',
        () async {
      final book = await openBook();
      addTearDown(book.db.close);
      await book.ledger.record(
        businessId: book.businessId,
        entry: post('modal', DateTime(2026, 9, 1), modal),
      );

      final delta = await book.outbox.next();
      expect(
        delta.map((row) => row.table).toSet(),
        {
          DbSchema.tableBusiness,
          DbSchema.tableAccount,
          DbSchema.tableEntry,
          DbSchema.tableLine,
        },
      );
      expect(delta.every((row) => !row.carried), isTrue);
      expect(
        delta.every((row) => row.values['dirty'] == 1),
        isTrue,
      );
      expect(
        delta.first.updatedAt <= delta.last.updatedAt,
        isTrue,
      );

      await book.outbox.confirm(delta);
      expect(await book.outbox.pendingCount(), 0);
      expect(await book.outbox.next(), isEmpty);
    });

    test('ikut menaikkan induk yang sudah bersih, tanpa mengubahnya',
        () async {
      final book = await openBook();
      addTearDown(book.db.close);
      final party = await book.master.saveParty(
        businessId: book.businessId,
        name: 'Rina',
      );
      await book.outbox.confirm(await book.outbox.next());

      await book.ledger.record(
        businessId: book.businessId,
        entry: post(
          'dengan-pihak',
          DateTime(2026, 9, 4),
          PostRequest(
            kind: EntryKind.penjualanKredit,
            amount: Money(20000),
            partyId: party.id,
          ),
        ),
      );
      final pushedParty = await rowsOf(
        book.db,
        DbSchema.tableParty,
        where: 'id = ?',
        args: [party.id],
      );

      final delta = await book.outbox.next();
      final businessKey = '${DbSchema.tableBusiness}:${book.businessId}';
      final partyKey = '${DbSchema.tableParty}:${party.id}';
      expect(delta.map((row) => row.key), containsAll([businessKey, partyKey]));
      expect(
        delta.where((row) => row.carried).map((row) => row.key).toSet(),
        {businessKey, partyKey},
      );

      await book.outbox.confirm(delta, at: 999999);
      // Baris yang cuma dititip tidak boleh ikut dianggap dikonfirmasi.
      final afterParty = await rowsOf(
        book.db,
        DbSchema.tableParty,
        where: 'id = ?',
        args: [party.id],
      );
      expect(afterParty.single['updated_at'], pushedParty.single['updated_at']);
      expect(afterParty.single['dirty'], 0);
      expect(
        await countOf(book.db, DbSchema.tableEntry, where: 'dirty = 0'),
        1,
      );
      expect(await book.outbox.pendingCount(), 0);
    });

    test('kiriman terpotong tetap berdiri sendiri: induk ikut naik', () async {
      final book = await openBook();
      addTearDown(book.db.close);
      await book.ledger.record(
        businessId: book.businessId,
        entry: post('modal', DateTime(2026, 9, 1), modal),
      );

      final delta = await book.outbox.next(limit: 2);
      expect(delta, isNotEmpty);
      final keys = delta.map((row) => row.key).toSet();
      for (final row in delta.where(
        (row) => row.table == DbSchema.tableLine,
      )) {
        expect(
          keys,
          contains('${DbSchema.tableEntry}:${row.values['entry_id']}'),
        );
      }
      for (final row in delta.where(
        (row) => row.table == DbSchema.tableEntry,
      )) {
        expect(
          keys,
          contains('${DbSchema.tableBusiness}:${row.values['business_id']}'),
        );
      }
    });

    test('kuburan ikut antre sampai server mengenalnya', () async {
      final book = await openBook();
      addTearDown(book.db.close);
      await book.ledger.record(
        businessId: book.businessId,
        entry: post('modal', DateTime(2026, 9, 1), modal),
      );
      await book.outbox.confirm(await book.outbox.next());

      final doddy = await book.master.saveParty(
        businessId: book.businessId,
        name: 'Dodi',
      );
      await book.master.deleteParty(doddy.id);
      final delta = await book.outbox.next();
      final graves =
          delta.where((row) => row.table == DbSchema.tableParty).toList();
      expect(graves, hasLength(1));
      expect(graves.single.id, doddy.id);
      expect(graves.single.isTombstone, isTrue);

      await markPushed(book.db, DbSchema.tableParty, doddy.id);
      expect(await book.outbox.pendingCount(), 0);
    });
  });

  group('master', () {
    test('nama dipangkas, pencarian tidak peduli besar huruf', () async {
      final book = await openBook();
      addTearDown(book.db.close);

      final created = await book.master.saveParty(
        businessId: book.businessId,
        name: '  Rina Pasar  ',
        phone: '  ',
      );
      final updated = await book.master.saveParty(
        id: created.id,
        businessId: book.businessId,
        name: 'Rina Pasar Baru',
      );

      final all = await book.master.parties(book.businessId);
      expect(all, hasLength(1));
      expect(all.single.id, created.id);
      expect(updated.id, created.id);
      expect(all.single.name, 'Rina Pasar Baru');
      expect(all.single.phone, isNull);
      expect(
        await book.master.parties(book.businessId, search: 'PASA'),
        hasLength(1),
      );
      expect(
        await book.master.parties(book.businessId, search: 'budi'),
        isEmpty,
      );
    });

    test('nama kosong ditolak', () async {
      final book = await openBook();
      addTearDown(book.db.close);

      await expectLater(
        book.master.saveParty(businessId: book.businessId, name: '   '),
        throwsA(isA<ArgumentError>()),
      );
      await expectLater(
        book.master.saveItem(businessId: book.businessId, name: ''),
        throwsA(isA<ArgumentError>()),
      );
      expect(await book.master.parties(book.businessId), isEmpty);
      expect(await book.master.items(book.businessId), isEmpty);
    });

    test('menghapus pihak tidak menghapus jurnal yang memakainya', () async {
      final book = await openBook();
      addTearDown(book.db.close);

      final party = await book.master.saveParty(
        businessId: book.businessId,
        name: 'Rina',
      );
      await book.ledger.record(
        businessId: book.businessId,
        entry: post(
          'piutang-rina',
          DateTime(2026, 9, 4),
          PostRequest(
            kind: EntryKind.penjualanKredit,
            amount: Money(20000),
            partyId: party.id,
          ),
        ),
      );
      await book.master.deleteParty(party.id);

      expect(await book.master.parties(book.businessId), isEmpty);
      final kept = await book.ledger.entries(businessId: book.businessId);
      expect(kept.single.partyId, party.id);
      expect(
        await countOf(book.db, DbSchema.tableParty, where: 'deleted = 1'),
        1,
      );
    });

    test('harga barang disimpan sebagai rupiah utuh', () async {
      final book = await openBook();
      addTearDown(book.db.close);

      await book.master.saveItem(
        businessId: book.businessId,
        name: 'Es Teh',
        unit: 'gelas',
        salePrice: Money(5000),
        buyPrice: Money(2500),
        tracksStock: true,
      );
      final item = (await book.master.items(book.businessId)).single;
      expect(item.unit, 'gelas');
      expect(item.salePrice, Money(5000));
      expect(item.buyPrice, Money(2500));
      expect(item.tracksStock, isTrue);

      final stored = await rowsOf(book.db, DbSchema.tableItem);
      expect(stored.single['sale_price'], 5000);
      expect(stored.single['tracks_stock'], 1);

      await book.master.saveItem(
        id: item.id,
        businessId: book.businessId,
        name: 'Es Teh Manis',
        unit: ' ',
        salePrice: Money(6000),
        tracksStock: false,
      );
      final edited = (await book.master.items(book.businessId)).single;
      expect(edited.id, item.id);
      expect(edited.name, 'Es Teh Manis');
      expect(edited.unit, 'pcs');
      expect(edited.salePrice, Money(6000));
      expect(edited.tracksStock, isFalse);
    });
  });

  group('bagan akun', () {
    test('sub-akan dibaca jenisnya dari digit pertama nomornya', () async {
      final book = await openBook();
      addTearDown(book.db.close);

      final id = await book.ledger.addAccount(
        businessId: book.businessId,
        code: '6200.01',
        name: '  Bahan baku  ',
      );
      final stored = (await book.ledger.accounts(book.businessId))
          .firstWhere((account) => account.id == id);
      expect(stored.code, '6200.01');
      expect(stored.name, 'Bahan baku');
      expect(stored.type, AccountType.expense);
    });

    test('nomor yang bukan akun ditolak, nomor kembar juga', () async {
      final book = await openBook();
      addTearDown(book.db.close);

      for (final code in ['4000', '6', '', 'kas', '1100.']) {
        await expectLater(
          book.ledger.addAccount(
            businessId: book.businessId,
            code: code,
            name: 'Entah',
          ),
          throwsA(
            isA<LedgerException>().having(
              (error) => error.code,
              'code',
              'account_code_unsupported',
            ),
          ),
          reason: 'kode $code tidak boleh tersimpan',
        );
      }
      await expectLater(
        book.ledger.addAccount(
          businessId: book.businessId,
          code: '1100',
          name: 'Kas lagi',
        ),
        throwsA(
          isA<LedgerException>().having(
            (error) => error.code,
            'code',
            'account_code_taken',
          ),
        ),
      );
      expect(
        await countOf(book.db, DbSchema.tableAccount),
        ChartOfAccounts.seed.length,
      );
    });

    test('pos semaian bertahan, sub-akan boleh dibuang', () async {
      final book = await openBook();
      addTearDown(book.db.close);

      final accounts = await book.ledger.accounts(book.businessId);
      await expectLater(
        book.ledger.deleteAccount(accounts.first.id),
        throwsA(
          isA<LedgerException>().having(
            (error) => error.code,
            'code',
            'account_is_seeded',
          ),
        ),
      );

      final extra = await book.ledger.addAccount(
        businessId: book.businessId,
        code: '6200.02',
        name: 'Gas',
      );
      await book.ledger.deleteAccount(extra);
      expect(
        await book.ledger.accounts(book.businessId),
        hasLength(ChartOfAccounts.seed.length),
      );
      expect(
        await countOf(book.db, DbSchema.tableAccount, where: 'deleted = 1'),
        1,
      );
    });

    test('baris jurnal tetap terbaca setelah akunnya dibuang', () async {
      final book = await openBook();
      addTearDown(book.db.close);

      final extra = await book.ledger.addAccount(
        businessId: book.businessId,
        code: '6200.03',
        name: 'Kresek',
      );
      await book.ledger.record(
        businessId: book.businessId,
        entry: post(
          'kresek',
          DateTime(2026, 9, 6),
          const PostRequest(
            kind: EntryKind.pengeluaran,
            amount: Money(2000),
            targetAccountCode: '6200.03',
          ),
        ),
      );
      await book.ledger.deleteAccount(extra);

      final loaded = await book.ledger.entries(businessId: book.businessId);
      expect(loaded.single.totalDebit, Money(2000));
      expect(
        Reports.byAccount(loaded).map((row) => row.accountCode).toList(),
        contains('6200.03'),
      );
    });
  });

  group('laporan dari penyimpanan', () {
    test('neraca membaca buku yang sama dengan hitungan manual', () async {
      final book = await openBook();
      addTearDown(book.db.close);

      final party = await book.master.saveParty(
        businessId: book.businessId,
        name: 'Rina',
      );
      final entries = [
        post('1', DateTime(2026, 9, 1), modal),
        post(
          '2',
          DateTime(2026, 9, 2),
          const PostRequest(
            kind: EntryKind.penjualanTunai,
            amount: Money(25000),
            cost: Money(10000),
          ),
        ),
        post(
          '3',
          DateTime(2026, 9, 3),
          const PostRequest(
            kind: EntryKind.pengeluaran,
            amount: Money(5000),
            targetAccountCode: '6200',
          ),
        ),
        post(
          '4',
          DateTime(2026, 9, 4),
          PostRequest(
            kind: EntryKind.penjualanKredit,
            amount: Money(20000),
            partyId: party.id,
          ),
        ),
        post(
          '5',
          DateTime(2026, 9, 5),
          PostRequest(
            kind: EntryKind.penerimaanPiutang,
            amount: Money(10000),
            partyId: party.id,
          ),
        ),
      ];
      for (final entry in entries) {
        await book.ledger.record(businessId: book.businessId, entry: entry);
      }

      final loaded = await book.ledger.entries(businessId: book.businessId);
      expect(loaded, hasLength(entries.length));
      expect(
        Reports.balanceOfCode(loaded, AccountCode.kas.code),
        Money(330000),
      );
      expect(
        Reports.balanceOfCode(loaded, AccountCode.piutang.code),
        Money(10000),
      );
      final pl = Reports.profitAndLoss(loaded);
      expect(pl.revenue, Money(45000));
      expect(pl.expense, Money(15000));
      expect(pl.profit, Money(30000));
      expect(
        Reports.balanceOf(loaded, AccountType.asset),
        Reports.balanceOf(loaded, AccountType.liability) +
            Reports.balanceOf(loaded, AccountType.equity) +
            pl.profit,
      );
      expect(
        Reports.cashFlowByDay(loaded).map((day) => day.day.day).toList(),
        [1, 2, 3, 5],
      );
    });
  });
}

import 'package:sqflite/sqflite.dart';

import '../core/money.dart';
import '../domain/account.dart';
import '../domain/ledger.dart';
import '../domain/ledger_engine.dart';
import 'db.dart';

/// Menyimpan dan memuat jurnal. Domain tidak tahu ada SQLite di baliknya;
/// yang melewati batas ini hanya angka dan tanggal.
class LedgerRepository {
  LedgerRepository(this.db, {required this.deviceId});

  final Database db;
  final String deviceId;

  /// Satu transaksi ditulis utuh: kepalanya beserta seluruh sisinya, atau
  /// tidak sama sekali.
  Future<void> record({
    required String businessId,
    required LedgerEntry entry,
    int? nowMicros,
  }) async {
    if (!entry.isBalanced) {
      throw const LedgerException(
        'unbalanced_entry',
        'Catatan ini tidak seimbang dan tidak disimpan.',
      );
    }
    final moment = nowMicros ?? DateTime.now().microsecondsSinceEpoch;
    await db.transaction(
      (txn) => _insertEntry(
        txn,
        businessId: businessId,
        entry: entry,
        moment: moment,
      ),
    );
  }

  /// Mengganti sisi jurnal sebuah transaksi.
  ///
  /// Sisi yang belum pernah berangkat (dirty = 1) dihapus fisik: tidak ada
  /// salinan di server yang perlu dikabari tentang kematiannya. Sisi yang
  /// sudah berangkat ditandai deleted, supaya perangkat lain ikut membuangnya.
  Future<void> replaceLines({
    required String businessId,
    required LedgerEntry entry,
    int? nowMicros,
  }) async {
    if (!entry.isBalanced) {
      throw const LedgerException(
        'unbalanced_entry',
        'Catatan ini tidak seimbang dan tidak disimpan.',
      );
    }
    final moment = nowMicros ?? DateTime.now().microsecondsSinceEpoch;
    await db.transaction((txn) async {
      final stale = await txn.query(
        DbSchema.tableLine,
        columns: ['id', 'dirty'],
        where: 'entry_id = ? AND deleted = 0',
        whereArgs: [entry.id],
      );
      for (final row in stale) {
        if (row['dirty'] == 1) {
          await txn.delete(
            DbSchema.tableLine,
            where: 'id = ?',
            whereArgs: [row['id']],
          );
        } else {
          await _bury(txn, DbSchema.tableLine, row['id'] as String, moment);
        }
      }
      await txn.update(
        DbSchema.tableEntry,
        {
          'entered_on': _dayKey(entry.date),
          'kind': entry.kindCode,
          'description': entry.description,
          'party_id': entry.partyId,
          'item_id': entry.itemId,
          'quantity': entry.quantity,
          'unit_price': entry.unitPrice,
          'cash_account_code': entry.cashAccountCode,
          'updated_at': moment,
          'dirty': 1,
          'device_id': deviceId,
        },
        where: 'id = ?',
        whereArgs: [entry.id],
      );
      await _insertLines(txn, businessId, entry, moment);
    });
  }

  Future<void> deleteEntry(String entryId, {int? nowMicros}) async {
    final moment = nowMicros ?? DateTime.now().microsecondsSinceEpoch;
    await db.transaction((txn) async {
      await _bury(txn, DbSchema.tableEntry, entryId, moment);
      final lines = await txn.query(
        DbSchema.tableLine,
        columns: ['id'],
        where: 'entry_id = ? AND deleted = 0',
        whereArgs: [entryId],
      );
      for (final line in lines) {
        await _bury(txn, DbSchema.tableLine, line['id'] as String, moment);
      }
    });
  }

  /// Jurnal dalam rentang, siap dibaca [Reports]. Urut dari yang paling tua.
  Future<List<LedgerEntry>> entries({
    required String businessId,
    DateTime? from,
    DateTime? to,
  }) async {
    final where = ['business_id = ?', 'deleted = 0'];
    final args = <Object?>[businessId];
    if (from != null) {
      where.add('entered_on >= ?');
      args.add(_dayKey(from));
    }
    if (to != null) {
      where.add('entered_on <= ?');
      args.add(_dayKey(to));
    }
    final heads = await db.query(
      DbSchema.tableEntry,
      where: where.join(' AND '),
      whereArgs: args,
      orderBy: 'entered_on, posted_at, id',
    );
    if (heads.isEmpty) return const [];

    final byId = <String, List<LedgerLine>>{};
    final ids = [for (final head in heads) head['id'] as String];
    for (final chunk in _chunks(ids)) {
      final marks = List.filled(chunk.length, '?').join(', ');
      final rows = await db.query(
        DbSchema.tableLine,
        where: 'entry_id IN ($marks) AND deleted = 0',
        whereArgs: chunk,
        orderBy: 'account_code, id',
      );
      for (final row in rows) {
        byId
            .putIfAbsent(row['entry_id'] as String, () => [])
            .add(
              LedgerLine(
                accountCode: row['account_code'] as String,
                debit: Money(row['debit'] as int),
                credit: Money(row['credit'] as int),
              ),
            );
      }
    }

    return [
      for (final head in heads)
        LedgerEntry(
          id: head['id'] as String,
          date: _dayFromDateKey(head['entered_on'] as int),
          kindCode: head['kind'] as String,
          description: head['description'] as String? ?? '',
          lines: byId[head['id']] ?? const [],
          partyId: head['party_id'] as String?,
          itemId: head['item_id'] as String?,
          quantity: head['quantity'] as int?,
          unitPrice: head['unit_price'] as int?,
          cashAccountCode: head['cash_account_code'] as String?,
        ),
    ];
  }

  Future<List<AccountRow>> accounts(String businessId) async {
    final rows = await db.query(
      DbSchema.tableAccount,
      where: 'business_id = ? AND deleted = 0',
      whereArgs: [businessId],
      orderBy: 'code',
    );
    return [
      for (final row in rows)
        AccountRow(
          id: row['id'] as String,
          businessId: row['business_id'] as String,
          code: row['code'] as String,
          name: row['name'] as String,
        ),
    ];
  }

  /// Sub-akan baru, misalnya `6200.01 Bahan baku`. Jenisnya dibaca dari digit
  /// pertama nomornya, jadi nomor yang salah awal tidak akan pernah tersimpan.
  Future<String> addAccount({
    required String businessId,
    required String code,
    required String name,
    int? nowMicros,
  }) async {
    final trimmed = code.trim();
    if (!RegExp(r'^[12356][0-9]{3}(\.[0-9]{2,4})*$').hasMatch(trimmed)) {
      throw const LedgerException(
        'account_code_unsupported',
        'Nomor akun harus dimulai dengan 1, 2, 3, 5, atau 6.',
      );
    }
    final moment = nowMicros ?? DateTime.now().microsecondsSinceEpoch;
    final taken = await db.query(
      DbSchema.tableAccount,
      columns: ['id'],
      where: 'business_id = ? AND code = ? AND deleted = 0',
      whereArgs: [businessId, trimmed],
      limit: 1,
    );
    if (taken.isNotEmpty) {
      throw LedgerException(
        'account_code_taken',
        'Nomor $trimmed sudah dipakai di usaha ini.',
      );
    }
    final id = deviceUuid.v4();
    await db.insert(DbSchema.tableAccount, {
      'id': id,
      'business_id': businessId,
      'code': trimmed,
      'name': name.trim(),
      'created_at': moment,
      'updated_at': moment,
      'deleted': 0,
      'dirty': 1,
      'device_id': deviceId,
    });
    return id;
  }

  /// Menghapus akun dari daftar. Baris jurnal yang sudah memakai kode itu
  /// dibiarkan utuh — sejarah tidak ikut terhapus hanya karena sebuah pos
  /// tidak lagi dipakai.
  Future<void> deleteAccount(String accountId, {int? nowMicros}) async {
    final rows = await db.query(
      DbSchema.tableAccount,
      columns: ['code'],
      where: 'id = ?',
      whereArgs: [accountId],
      limit: 1,
    );
    if (rows.isEmpty) return;
    final code = rows.first['code'] as String;
    if (ChartOfAccounts.isSeeded(code)) {
      throw LedgerException(
        'account_is_seeded',
        '$code dipakai perhitungan laporan, jadi tidak bisa dihapus.',
      );
    }
    final moment = nowMicros ?? DateTime.now().microsecondsSinceEpoch;
    await db.transaction(
      (txn) => _bury(txn, DbSchema.tableAccount, accountId, moment),
    );
  }

  Future<void> _insertEntry(
    DatabaseExecutor txn, {
    required String businessId,
    required LedgerEntry entry,
    required int moment,
  }) async {
    await txn.insert(DbSchema.tableEntry, {
      'id': entry.id,
      'business_id': businessId,
      'entered_on': _dayKey(entry.date),
      'posted_at': moment,
      'kind': entry.kindCode,
      'description': entry.description,
      'party_id': entry.partyId,
      'item_id': entry.itemId,
      'quantity': entry.quantity,
      'unit_price': entry.unitPrice,
      'cash_account_code': entry.cashAccountCode ?? AccountCode.kas.code,
      'created_at': moment,
      'updated_at': moment,
      'deleted': 0,
      'dirty': 1,
      'device_id': deviceId,
    });
    await _insertLines(txn, businessId, entry, moment);
  }

  Future<void> _insertLines(
    DatabaseExecutor txn,
    String businessId,
    LedgerEntry entry,
    int moment,
  ) async {
    for (final line in entry.lines) {
      await txn.insert(DbSchema.tableLine, {
        'id': deviceUuid.v4(),
        'entry_id': entry.id,
        'business_id': businessId,
        'account_code': line.accountCode,
        'debit': line.debit.rupees,
        'credit': line.credit.rupees,
        'created_at': moment,
        'updated_at': moment,
        'deleted': 0,
        'dirty': 1,
        'device_id': deviceId,
      });
    }
  }
}

/// Menandai sebuah baris sebagai kuburan: masih ada, masih dikirim, tapi sudah
/// tidak dibaca siapa-siapa.
Future<void> _bury(DatabaseExecutor txn, String table, String id, int moment) =>
    txn.update(
      table,
      {'deleted': 1, 'dirty': 1, 'updated_at': moment},
      where: 'id = ?',
      whereArgs: [id],
    );

int _dayKey(DateTime date) => date.year * 10000 + date.month * 100 + date.day;

DateTime _dayFromDateKey(int key) =>
    DateTime(key ~/ 10000, (key ~/ 100) % 100, key % 100);

/// `IN (...)` punya batas jumlah tanda tanya; jurnal panjang dipecah dulu.
List<List<String>> _chunks(List<String> ids, {int size = 100}) {
  final out = <List<String>>[];
  for (var i = 0; i < ids.length; i += size) {
    final end = i + size > ids.length ? ids.length : i + size;
    out.add(ids.sublist(i, end));
  }
  return out;
}

class AccountRow {
  const AccountRow({
    required this.id,
    required this.businessId,
    required this.code,
    required this.name,
  });

  final String id;
  final String businessId;
  final String code;
  final String name;

  AccountType get type => AccountCode.typeOfCode(code);
}

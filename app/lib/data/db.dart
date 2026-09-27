import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import '../domain/account.dart';

/// Nama berkas basis data di penyimpanan aplikasi.
const String kDatabaseFileName = 'karsa_business.db';

/// Kunci utama dibuat di perangkat. Yang semaian diturunkan dari isinya, supaya
/// dua perangkat milik pemilik yang sama menabur baris dengan id yang sama dan
/// upsert server tetap diam.
final Uuid deviceUuid = Uuid();

String seededAccountId(String businessId, String accountCode) =>
    _derivedId('karsa:account:$businessId:$accountCode');

String _derivedId(String input) {
  final hex = sha1
      .convert(utf8.encode(input))
      .bytes
      .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
  final variant =
      ((int.parse(hex[16], radix: 16) & 0x3) | 0x8).toRadixString(16);
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}'
      '-5${hex.substring(13, 16)}-$variant${hex.substring(17, 20)}'
      '-${hex.substring(20, 32)}';
}

/// Kolom yang wajib ada di tiap baris yang bisa disinkron. Server menambah
/// miliknya sendiri (owner_id, rev) dan tidak pernah menerimanya dari klien.
const String _syncColumns = '''
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    dirty INTEGER NOT NULL DEFAULT 1,
    device_id TEXT NOT NULL
''';

/// Skema SQLite. Neon adalah cermin 1:1 dari bentuk ini (blok 05 dokumen).
abstract final class DbSchema {
  static const int version = 1;

  static const String tableBusiness = 'business';
  static const String tableParty = 'party';
  static const String tableItem = 'item';
  static const String tableAccount = 'account';
  static const String tableEntry = 'ledger_entry';
  static const String tableLine = 'ledger_line';
  static const String tableStock = 'stock_movement';
  static const String tableMeta = 'meta';

  /// Nama tabel yang ikut dalam sinkronisasi, berurutan seperti orang
  /// membacanya: identitas, lalu jurnal, lalu pergerakan barang.
  static const List<String> syncableTables = [
    tableBusiness,
    tableParty,
    tableItem,
    tableAccount,
    tableEntry,
    tableLine,
    tableStock,
  ];

  static const List<String> statements = [
    '''
CREATE TABLE $tableBusiness (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
$_syncColumns
)''',
    '''
CREATE TABLE $tableParty (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES $tableBusiness(id),
  name TEXT NOT NULL,
  phone TEXT,
  note TEXT,
$_syncColumns
)''',
    '''
CREATE TABLE $tableItem (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES $tableBusiness(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pcs',
  sale_price INTEGER NOT NULL DEFAULT 0,
  buy_price INTEGER NOT NULL DEFAULT 0,
  tracks_stock INTEGER NOT NULL DEFAULT 0,
$_syncColumns
)''',
    '''
CREATE TABLE $tableAccount (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES $tableBusiness(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
$_syncColumns,
  UNIQUE(business_id, code)
)''',
    '''
CREATE TABLE $tableEntry (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES $tableBusiness(id),
  entered_on INTEGER NOT NULL,
  posted_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  party_id TEXT REFERENCES $tableParty(id),
  item_id TEXT REFERENCES $tableItem(id),
  quantity INTEGER,
  unit_price INTEGER,
  cash_account_code TEXT NOT NULL DEFAULT '1100',
$_syncColumns
)''',
    // account_code sengaja tidak menjadi foreign key: sebuah baris jurnal
    // adalah fakta sejarah dan harus tetap terbaca setelah akunnya diganti
    // nama atau dihapus dari daftar.
    '''
CREATE TABLE $tableLine (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES $tableEntry(id),
  business_id TEXT NOT NULL REFERENCES $tableBusiness(id),
  account_code TEXT NOT NULL,
  debit INTEGER NOT NULL DEFAULT 0,
  credit INTEGER NOT NULL DEFAULT 0,
$_syncColumns,
  CHECK (debit >= 0 AND credit >= 0),
  CHECK ((debit > 0) <> (credit > 0))
)''',
    '''
CREATE TABLE $tableStock (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES $tableBusiness(id),
  item_id TEXT NOT NULL REFERENCES $tableItem(id),
  entered_on INTEGER NOT NULL,
  direction INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  entry_id TEXT REFERENCES $tableEntry(id),
$_syncColumns,
  CHECK (direction IN (1, -1)),
  CHECK (quantity > 0)
)''',
    // meta khusus perangkat: tidak pernah dikirim, tidak punya kolom sinkron.
    '''
CREATE TABLE $tableMeta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)''',
    'CREATE INDEX idx_entry_business_date ON $tableEntry (business_id, entered_on)',
    'CREATE INDEX idx_line_entry ON $tableLine (entry_id)',
    'CREATE INDEX idx_party_business ON $tableParty (business_id)',
    'CREATE INDEX idx_item_business ON $tableItem (business_id)',
    'CREATE INDEX idx_stock_item ON $tableStock (item_id, entered_on)',
  ];

  /// Semua tabel sinkron diindeks pada dirty, karena itulah outbox-nya.
  static List<String> get dirtyIndexes => [
    for (final table in syncableTables)
      'CREATE INDEX idx_${table}_dirty ON $table (dirty, updated_at)',
  ];
}

/// Pembuka basis data dan pemilik satu-satunya untuk nilai perangkat.
abstract final class KarsaDatabase {
  static Future<Database> open({
    String? path,
    DatabaseFactory? factory,
  }) async {
    final opener = factory ?? databaseFactory;
    final target =
        path ?? p.join(await opener.getDatabasesPath(), kDatabaseFileName);
    final db = await opener.openDatabase(
      target,
      options: OpenDatabaseOptions(
        version: DbSchema.version,
        onConfigure: (db) => db.execute('PRAGMA foreign_keys = ON'),
        onCreate: (db, version) async {
          for (final statement in [
            ...DbSchema.statements,
            ...DbSchema.dirtyIndexes,
          ]) {
            await db.execute(statement);
          }
        },
      ),
    );
    await ensureDeviceId(db);
    return db;
  }

  /// Satu identitas tetap per pemasangan aplikasi; baris yang diubah perangkat
  /// ini bisa dibedakan dari perangkat lain di perangkat pemilik sendiri.
  static Future<String> ensureDeviceId(Database db) async {
    final existing = await metaValue(db, kMetaDeviceId);
    if (existing != null && existing.isNotEmpty) return existing;
    final generated = deviceUuid.v4();
    await putMeta(db, kMetaDeviceId, generated);
    return generated;
  }

  static Future<String?> metaValue(Database db, String key) async {
    final rows = await db.query(
      DbSchema.tableMeta,
      columns: ['value'],
      where: 'key = ?',
      whereArgs: [key],
      limit: 1,
    );
    return rows.isEmpty ? null : rows.first['value'] as String;
  }

  static Future<void> putMeta(Database db, String key, String value) =>
      db.insert(
        DbSchema.tableMeta,
        {'key': key, 'value': value},
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
}

const String kMetaDeviceId = 'device_id';
const String kMetaLastPulledRev = 'last_pulled_rev';
const String kMetaClockOffsetSeconds = 'clock_offset_seconds';

/// Usaha pertama ditaburi bagan akun dari [ChartOfAccounts.seed].
Future<String> createBusiness(
  Database db, {
  required String name,
  required String deviceId,
  String? id,
  int? nowMicros,
}) async {
  final moment = nowMicros ?? DateTime.now().microsecondsSinceEpoch;
  final businessId = id ?? deviceUuid.v4();
  return db.transaction((txn) async {
    await txn.insert(DbSchema.tableBusiness, {
      'id': businessId,
      'name': name.trim(),
      'created_at': moment,
      'updated_at': moment,
      'deleted': 0,
      'dirty': 1,
      'device_id': deviceId,
    });
    await seedAccounts(
      txn,
      businessId: businessId,
      deviceId: deviceId,
      nowMicros: moment,
    );
    return businessId;
  });
}

/// Menanam bagan akun. Id-nya diturunkan, jadi memanggil ini dua kali pada
/// usaha yang sama tetap menghasilkan sembilan baris yang sama.
Future<void> seedAccounts(
  DatabaseExecutor txn, {
  required String businessId,
  required String deviceId,
  int? nowMicros,
}) async {
  final moment = nowMicros ?? DateTime.now().microsecondsSinceEpoch;
  for (final account in ChartOfAccounts.seed) {
    await txn.insert(
      DbSchema.tableAccount,
      {
        'id': seededAccountId(businessId, account.code),
        'business_id': businessId,
        'code': account.code,
        'name': account.label,
        'created_at': moment,
        'updated_at': moment,
        'deleted': 0,
        'dirty': 1,
        'device_id': deviceId,
      },
      conflictAlgorithm: ConflictAlgorithm.ignore,
    );
  }
}

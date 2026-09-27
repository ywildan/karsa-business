import 'package:sqflite/sqflite.dart';

import 'db.dart';

/// Satu baris yang siap naik ke server.
class DeltaRow {
  const DeltaRow({
    required this.table,
    required this.id,
    required this.values,
    this.carried = false,
  });

  final String table;
  final String id;
  final Map<String, Object?> values;

  /// Baris yang ikut naik hanya karena jadi induk, bukan karena berubah.
  final bool carried;

  String get key => '$table:$id';

  int get updatedAt => values['updated_at'] as int? ?? 0;

  bool get isTombstone => values['deleted'] == 1;
}

/// Rujukan ke baris induk sebuah tabel sinkron.
class ParentRef {
  const ParentRef(this.column, this.table);

  final String column;
  final String table;
}

const Map<String, List<ParentRef>> _parents = {
  DbSchema.tableParty: [ParentRef('business_id', DbSchema.tableBusiness)],
  DbSchema.tableItem: [ParentRef('business_id', DbSchema.tableBusiness)],
  DbSchema.tableAccount: [ParentRef('business_id', DbSchema.tableBusiness)],
  DbSchema.tableEntry: [
    ParentRef('business_id', DbSchema.tableBusiness),
    ParentRef('party_id', DbSchema.tableParty),
    ParentRef('item_id', DbSchema.tableItem),
  ],
  DbSchema.tableLine: [
    ParentRef('business_id', DbSchema.tableBusiness),
    ParentRef('entry_id', DbSchema.tableEntry),
  ],
  DbSchema.tableStock: [
    ParentRef('business_id', DbSchema.tableBusiness),
    ParentRef('item_id', DbSchema.tableItem),
    ParentRef('entry_id', DbSchema.tableEntry),
  ],
};

/// Outbox tidak berupa tabel terpisah: outbox adalah `WHERE dirty = 1`.
class Outbox {
  Outbox(this.db);

  final Database db;

  /// Perubahan tertua lebih dulu, lalu induk yang belum ada di kiriman.
  ///
  /// Server memegang foreign key yang sama dengan SQLite, jadi satu sisi
  /// jurnal tidak boleh naik tanpa kepala transaksinya. Induk yang ikut naik
  /// meski tidak berubah hanya membuat server men-stempel ulang barisnya —
  /// aman diulang dan tidak menduplikasi apa pun.
  Future<List<DeltaRow>> next({int limit = 200}) async {
    final found = <String, DeltaRow>{};
    for (final table in DbSchema.syncableTables) {
      final rows = await db.query(
        table,
        where: 'dirty = 1',
        orderBy: 'updated_at',
        limit: limit,
      );
      for (final row in rows) {
        final id = row['id'] as String;
        found['$table:$id'] = DeltaRow(table: table, id: id, values: row);
      }
    }

    final ordered = found.values.toList()..sort(_byOlder);
    final batch = <String, DeltaRow>{
      for (final row in ordered.take(limit)) row.key: row,
    };

    final queue = batch.values.toList();
    while (queue.isNotEmpty) {
      final row = queue.removeLast();
      for (final ref in _parents[row.table] ?? const <ParentRef>[]) {
        final parentId = row.values[ref.column] as String?;
        if (parentId == null) continue;
        final key = '${ref.table}:$parentId';
        if (batch.containsKey(key)) continue;
        final parent = await _read(ref.table, parentId);
        if (parent == null) continue;
        batch[key] = parent;
        queue.add(parent);
      }
    }

    final result = batch.values.toList()..sort(_byOlder);
    return result;
  }

  /// Menutup kiriman yang sudah diterima server. Sampai langkah ini terjadi,
  /// barisnya masih dirty — aplikasi yang mati di tengah jalan tinggal
  /// mengulang dari pengambilan delta yang sama.
  Future<void> confirm(Iterable<DeltaRow> rows, {int? at}) async {
    final waiting = rows.where((row) => !row.carried).toList();
    if (waiting.isEmpty) return;
    final moment = at ?? DateTime.now().microsecondsSinceEpoch;
    await db.transaction((txn) async {
      for (final row in waiting) {
        await txn.update(
          row.table,
          {'dirty': 0, 'updated_at': moment},
          where: 'id = ?',
          whereArgs: [row.id],
        );
      }
    });
  }

  Future<int> pendingCount() async {
    var total = 0;
    for (final table in DbSchema.syncableTables) {
      final rows = await db.query(
        table,
        columns: ['id'],
        where: 'dirty = 1',
        limit: 1000,
      );
      total += rows.length;
    }
    return total;
  }

  Future<DeltaRow?> _read(String table, String id) async {
    final rows = await db.query(
      table,
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    final row = rows.first;
    return DeltaRow(
      table: table,
      id: row['id'] as String,
      values: row,
      carried: row['dirty'] != 1,
    );
  }
}

int _byOlder(DeltaRow a, DeltaRow b) {
  final byTime = a.updatedAt.compareTo(b.updatedAt);
  return byTime != 0 ? byTime : a.key.compareTo(b.key);
}

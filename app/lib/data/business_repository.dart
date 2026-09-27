import 'package:sqflite/sqflite.dart';

import 'db.dart';

class BusinessRow {
  const BusinessRow({required this.id, required this.name});

  final String id;
  final String name;
}

/// Satu perangkat boleh memegang lebih dari satu usaha, tetapi versi pertama
/// ini membuka yang paling tua saja. Daftar usaha baru muncul bersama
/// sinkronisasi, karena usaha tambahan datang dari perangkat lain.
class BusinessRepository {
  BusinessRepository(this.db, {required this.deviceId});

  final Database db;
  final String deviceId;

  Future<BusinessRow?> current() async {
    final rows = await db.query(
      DbSchema.tableBusiness,
      columns: ['id', 'name'],
      where: 'deleted = 0',
      orderBy: 'created_at, id',
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return BusinessRow(
      id: rows.first['id'] as String,
      name: rows.first['name'] as String,
    );
  }

  Future<String> create(String name) =>
      createBusiness(db, name: name, deviceId: deviceId);

  Future<void> rename(String id, String name) async {
    final trimmed = name.trim();
    if (trimmed.isEmpty) {
      throw ArgumentError('Nama usaha tidak boleh kosong.');
    }
    await db.update(
      DbSchema.tableBusiness,
      {
        'name': trimmed,
        'updated_at': DateTime.now().microsecondsSinceEpoch,
        'dirty': 1,
        'device_id': deviceId,
      },
      where: 'id = ? AND deleted = 0',
      whereArgs: [id],
    );
  }
}

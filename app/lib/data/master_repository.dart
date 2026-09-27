import 'package:sqflite/sqflite.dart';

import '../core/money.dart';
import 'db.dart';

/// Pihak (pelanggan atau pemasok) dan barang. Dua-duanya cuma daftar nama:
/// yang menentukan angka tetap jurnal.
class MasterRepository {
  MasterRepository(this.db, {required this.deviceId});

  final Database db;
  final String deviceId;

  Future<PartyRow> saveParty({
    String? id,
    required String businessId,
    required String name,
    String? phone,
    String? note,
    int? nowMicros,
  }) async {
    final trimmed = name.trim();
    if (trimmed.isEmpty) {
      throw ArgumentError('Nama pihak tidak boleh kosong.');
    }
    final moment = nowMicros ?? DateTime.now().microsecondsSinceEpoch;
    final party = PartyRow(
      id: id ?? deviceUuid.v4(),
      businessId: businessId,
      name: trimmed,
      phone: _clean(phone),
      note: _clean(note),
    );
    final values = <String, Object?>{
      ...party.columns(),
      'updated_at': moment,
      'dirty': 1,
      'device_id': deviceId,
    };
    if (id == null) {
      await db.insert(
        DbSchema.tableParty,
        {...values, 'id': party.id, 'created_at': moment, 'deleted': 0},
      );
    } else {
      await db.update(
        DbSchema.tableParty,
        values,
        where: 'id = ? AND deleted = 0',
        whereArgs: [id],
      );
    }
    return party;
  }

  Future<List<PartyRow>> parties(String businessId, {String? search}) async {
    final where = ['business_id = ?', 'deleted = 0'];
    final args = <Object?>[businessId];
    final needle = _clean(search);
    if (needle != null) {
      where.add('lower(name) LIKE ?');
      args.add('%${needle.toLowerCase()}%');
    }
    final rows = await db.query(
      DbSchema.tableParty,
      where: where.join(' AND '),
      whereArgs: args,
      orderBy: 'name',
    );
    return [for (final row in rows) PartyRow.fromRow(row)];
  }

  Future<ItemRow> saveItem({
    String? id,
    required String businessId,
    required String name,
    String unit = 'pcs',
    Money salePrice = Money.zero,
    Money buyPrice = Money.zero,
    bool tracksStock = false,
    int? nowMicros,
  }) async {
    final trimmed = name.trim();
    if (trimmed.isEmpty) {
      throw ArgumentError('Nama barang tidak boleh kosong.');
    }
    final moment = nowMicros ?? DateTime.now().microsecondsSinceEpoch;
    final item = ItemRow(
      id: id ?? deviceUuid.v4(),
      businessId: businessId,
      name: trimmed,
      unit: _clean(unit) ?? 'pcs',
      salePrice: salePrice,
      buyPrice: buyPrice,
      tracksStock: tracksStock,
    );
    final values = <String, Object?>{
      ...item.columns(),
      'updated_at': moment,
      'dirty': 1,
      'device_id': deviceId,
    };
    if (id == null) {
      await db.insert(
        DbSchema.tableItem,
        {...values, 'id': item.id, 'created_at': moment, 'deleted': 0},
      );
    } else {
      await db.update(
        DbSchema.tableItem,
        values,
        where: 'id = ? AND deleted = 0',
        whereArgs: [id],
      );
    }
    return item;
  }

  Future<List<ItemRow>> items(String businessId) async {
    final rows = await db.query(
      DbSchema.tableItem,
      where: 'business_id = ? AND deleted = 0',
      whereArgs: [businessId],
      orderBy: 'name',
    );
    return [for (final row in rows) ItemRow.fromRow(row)];
  }

  Future<void> deleteParty(String id, {int? nowMicros}) => _bury(
    DbSchema.tableParty,
    id,
    nowMicros,
  );

  Future<void> deleteItem(String id, {int? nowMicros}) => _bury(
    DbSchema.tableItem,
    id,
    nowMicros,
  );

  Future<void> _bury(String table, String id, int? nowMicros) => db.update(
    table,
    {
      'deleted': 1,
      'dirty': 1,
      'updated_at': nowMicros ?? DateTime.now().microsecondsSinceEpoch,
      'device_id': deviceId,
    },
    where: 'id = ?',
    whereArgs: [id],
  );
}

String? _clean(String? value) {
  final trimmed = value?.trim() ?? '';
  return trimmed.isEmpty ? null : trimmed;
}

class PartyRow {
  const PartyRow({
    required this.id,
    required this.businessId,
    required this.name,
    this.phone,
    this.note,
  });

  factory PartyRow.fromRow(Map<String, Object?> row) => PartyRow(
    id: row['id'] as String,
    businessId: row['business_id'] as String,
    name: row['name'] as String,
    phone: row['phone'] as String?,
    note: row['note'] as String?,
  );

  final String id;
  final String businessId;
  final String name;
  final String? phone;
  final String? note;

  /// Kolom isinya saja; kunci dan penanda sinkron dipasang oleh pemanggil.
  Map<String, Object?> columns() => {
    'business_id': businessId,
    'name': name,
    'phone': phone,
    'note': note,
  };
}

class ItemRow {
  const ItemRow({
    required this.id,
    required this.businessId,
    required this.name,
    required this.unit,
    required this.salePrice,
    required this.buyPrice,
    required this.tracksStock,
  });

  factory ItemRow.fromRow(Map<String, Object?> row) => ItemRow(
    id: row['id'] as String,
    businessId: row['business_id'] as String,
    name: row['name'] as String,
    unit: row['unit'] as String,
    salePrice: Money(row['sale_price'] as int),
    buyPrice: Money(row['buy_price'] as int),
    tracksStock: (row['tracks_stock'] as int) == 1,
  );

  final String id;
  final String businessId;
  final String name;
  final String unit;
  final Money salePrice;
  final Money buyPrice;
  final bool tracksStock;

  Map<String, Object?> columns() => {
    'business_id': businessId,
    'name': name,
    'unit': unit,
    'sale_price': salePrice.rupees,
    'buy_price': buyPrice.rupees,
    'tracks_stock': tracksStock ? 1 : 0,
  };
}

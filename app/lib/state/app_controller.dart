import 'package:flutter/foundation.dart';
import 'package:sqflite/sqflite.dart';

import '../core/format.dart';
import '../core/money.dart';
import '../data/business_repository.dart';
import '../data/db.dart';
import '../data/ledger_repository.dart';
import '../data/master_repository.dart';
import '../data/outbox.dart';
import '../domain/account.dart';
import '../domain/ledger.dart';
import '../domain/ledger_engine.dart';
import '../domain/reports.dart';

enum AppStage { loading, needsBusiness, ready, failed }

/// Satu-satunya pemegang keadaan yang bisa diubah.
///
/// Layar tidak pernah menyentuh basis data dan tidak pernah menyimpan salinan
/// jurnal sendiri: mereka membaca dari sini lalu memanggil aksi. Setelah
/// sebuah aksi, semuanya dibaca ulang — pada skala ratusan catatan per bulan,
/// membaca kembali lebih murah daripada satu angka yang tertinggal.
class AppController extends ChangeNotifier {
  AppController._(this._db, this.deviceId);

  final Database _db;
  final String deviceId;

  late final LedgerRepository _ledger = LedgerRepository(
    _db,
    deviceId: deviceId,
  );
  late final MasterRepository _master = MasterRepository(
    _db,
    deviceId: deviceId,
  );
  late final BusinessRepository _businesses = BusinessRepository(
    _db,
    deviceId: deviceId,
  );

  late final Outbox outbox = Outbox(_db);

  AppStage stage = AppStage.loading;
  String? failure;

  BusinessRow? _business;
  List<LedgerEntry> _entries = const [];
  List<AccountRow> _accounts = const [];
  List<PartyRow> _parties = const [];
  List<ItemRow> _items = const [];
  int _pending = 0;
  bool _busy = false;

  BusinessRow? get business => _business;
  List<LedgerEntry> get entries => _entries;
  List<AccountRow> get accounts => _accounts;
  List<PartyRow> get parties => _parties;
  List<ItemRow> get items => _items;
  int get pendingCount => _pending;
  bool get busy => _busy;

  /// Nomor usaha ada di mana-mana, tetapi layar tidak boleh tahu cara
  /// mengambilnya.
  String get businessId => _business?.id ?? '';

  List<AccountRow> accountsOfType(AccountType type) =>
      _accounts.where((account) => account.type == type).toList();

  AccountRow? accountByCode(String code) {
    for (final account in _accounts) {
      if (account.code == code) return account;
    }
    return null;
  }

  PartyRow? party(String? id) {
    if (id == null) return null;
    for (final party in _parties) {
      if (party.id == id) return party;
    }
    return null;
  }

  ItemRow? item(String? id) {
    if (id == null) return null;
    for (final item in _items) {
      if (item.id == id) return item;
    }
    return null;
  }

  Money get cash => Reports.balanceOfCode(_entries, AccountCode.kas.code);
  Money get receivable =>
      Reports.balanceOfCode(_entries, AccountCode.piutang.code);
  Money get payable => Reports.balanceOfCode(_entries, AccountCode.hutang.code);
  Money get inventory =>
      Reports.balanceOfCode(_entries, AccountCode.persediaan.code);

  ProfitAndLoss profitFor(DateTime month) => Reports.profitAndLoss(
    _entries,
    from: startOfMonth(month),
    to: endOfMonth(month),
  );

  /// Arus kas satu hari, untuk grafik tujuh hari.
  Money inflowOn(DateTime day) => _cashOn(day, true);
  Money outflowOn(DateTime day) => _cashOn(day, false);

  List<LedgerEntry> entriesOn(DateTime day) => [
    for (final entry in _entries)
      if (isSameDay(entry.date, day)) entry,
  ];

  List<LedgerEntry> entriesIn(DateTime month) {
    final from = startOfMonth(month);
    final to = endOfMonth(month);
    return [
      for (final entry in _entries)
        if (!entry.date.isBefore(from) && !entry.date.isAfter(to)) entry,
    ];
  }

  Money _cashOn(DateTime day, bool incoming) {
    var total = 0;
    for (final entry in entriesOn(day)) {
      for (final line in entry.lines) {
        if (line.accountCode != AccountCode.kas.code) continue;
        total += (incoming ? line.debit : line.credit).rupees;
      }
    }
    return Money(total);
  }

  /// [path] hanya untuk tes: basis data yang sama, lokasinya berbeda. Semua
  /// hal lain — skema, identitas perangkat, isi tab — tetap milik
  /// [KarsaDatabase], jadi layar diuji apa adanya.
  static Future<AppController> launch({String? path}) async {
    final db = await KarsaDatabase.open(path: path);
    final deviceId = await KarsaDatabase.ensureDeviceId(db);
    final controller = AppController._(db, deviceId);
    await controller.reload();
    return controller;
  }

  Future<void> reload() async {
    try {
      final business = await _businesses.current();
      if (business == null) {
        _business = null;
        _entries = const [];
        _accounts = const [];
        _parties = const [];
        _items = const [];
        _pending = 0;
        failure = null;
        stage = AppStage.needsBusiness;
      } else {
        final loaded = await _ledger.entries(businessId: business.id);
        final accounts = await _ledger.accounts(business.id);
        final parties = await _master.parties(business.id);
        final items = await _master.items(business.id);
        final pending = await outbox.pendingCount();
        _business = business;
        _entries = loaded;
        _accounts = accounts;
        _parties = parties;
        _items = items;
        _pending = pending;
        failure = null;
        stage = AppStage.ready;
      }
    } on Object catch (error) {
      failure = _explain(error);
      stage = AppStage.failed;
    }
    notifyListeners();
  }

  Future<String?> createBusinessNamed(String name) async {
    final trimmed = name.trim();
    if (trimmed.isEmpty) return 'Nama usaha belum diisi.';
    return _write(() async {
      await _businesses.create(trimmed);
      await reload();
    });
  }

  Future<String?> renameBusiness(String name) async {
    final business = _business;
    if (business == null) return 'Belum ada usaha di perangkat ini.';
    return _write(() async {
      await _businesses.rename(business.id, name);
      await reload();
    });
  }

  Future<String?> post(PostRequest request) => _write(() async {
    final entry = LedgerEngine.entry(
      id: deviceUuid.v4(),
      date: request.date ?? DateTime.now(),
      request: request,
    );
    await _ledger.record(businessId: businessId, entry: entry);
    await reload();
  });

  Future<String?> removeEntry(String entryId) => _write(() async {
    await _ledger.deleteEntry(entryId);
    await reload();
  });

  Future<String?> saveParty({
    String? id,
    required String name,
    String? phone,
  }) => _write(() async {
    await _master.saveParty(
      id: id,
      businessId: businessId,
      name: name,
      phone: phone,
    );
    await reload();
  });

  Future<String?> removeParty(String id) => _write(() async {
    await _master.deleteParty(id);
    await reload();
  });

  Future<String?> saveItem({
    String? id,
    required String name,
    String unit = 'pcs',
    Money salePrice = Money.zero,
    Money buyPrice = Money.zero,
    bool tracksStock = false,
  }) => _write(() async {
    await _master.saveItem(
      id: id,
      businessId: businessId,
      name: name,
      unit: unit,
      salePrice: salePrice,
      buyPrice: buyPrice,
      tracksStock: tracksStock,
    );
    await reload();
  });

  Future<String?> removeItem(String id) => _write(() async {
    await _master.deleteItem(id);
    await reload();
  });

  Future<String?> addAccount({required String code, required String name}) =>
      _write(() async {
        await _ledger.addAccount(
          businessId: businessId,
          code: code,
          name: name,
        );
        await reload();
      });

  Future<String?> removeAccount(String accountId) => _write(() async {
    await _ledger.deleteAccount(accountId);
    await reload();
  });

  /// Semua tulisan berjalan lewat sini: satu kegagalan tidak boleh membuat
  /// layar menunggu selamanya, dan pengguna harus membaca alasannya dalam
  /// bahasanya sendiri.
  Future<String?> _write(Future<void> Function() body) async {
    _busy = true;
    notifyListeners();
    try {
      await body();
      return null;
    } on LedgerException catch (error) {
      return error.message;
    } on ArgumentError catch (error) {
      return '${error.message}';
    } on Object catch (error) {
      return _explain(error);
    } finally {
      _busy = false;
      notifyListeners();
    }
  }

  static String _explain(Object error) =>
      'Penyimpanan di perangkat ini bermasalah: $error';
}

import '../core/money.dart';
import 'account.dart';
import 'ledger.dart';

/// Sepuluh hal yang bisa dilakukan pengguna. Nama enum-nya adalah bahasa
/// pengguna, bukan bahasa akuntansi.
enum EntryKind {
  modalAwal('modal_awal', 'Modal awal'),
  pemasukan('pemasukan', 'Pemasukan'),
  pengeluaran('pengeluaran', 'Pengeluaran'),
  penjualanTunai('penjualan_tunai', 'Jualan, langsung bayar'),
  penjualanKredit('penjualan_kredit', 'Jualan, belum dibayar'),
  penerimaanPiutang('penerimaan_piutang', 'Terima cicilan piutang'),
  pembelianTunai('pembelian_tunai', 'Beli stok, bayar tunai'),
  pembelianKredit('pembelian_kredit', 'Beli stok, dibayar belakangan'),
  pembayaranHutang('pembayaran_hutang', 'Bayar hutang'),
  prive('prive', 'Ambil untuk pribadi');

  const EntryKind(this.code, this.label);

  final String code;
  final String label;

  static EntryKind? fromCode(String code) {
    for (final kind in EntryKind.values) {
      if (kind.code == code) return kind;
    }
    return null;
  }
}

/// Maksud pengguna, sebelum diterjemahkan menjadi sisi debit dan kredit.
class PostRequest {
  const PostRequest({
    required this.kind,
    required this.amount,
    this.date,
    this.description = '',
    this.targetAccountCode,
    this.partyId,
    this.itemId,
    this.quantity,
    this.unitPrice,
    this.cost,
    this.cashAccountCode,
  });

  final EntryKind kind;
  final Money amount;
  final DateTime? date;
  final String description;

  /// Akun pendapatan atau beban yang dituju, untuk pemasukan dan pengeluaran.
  final String? targetAccountCode;
  final String? partyId;
  final String? itemId;
  final int? quantity;
  final int? unitPrice;

  /// Modal barang yang keluar, hanya untuk penjualan ber-stok.
  final Money? cost;
  final String? cashAccountCode;
}

class LedgerException implements Exception {
  const LedgerException(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => 'LedgerException($code): $message';
}

/// Menerjemahkan maksud pengguna menjadi jurnal dua sisi yang seimbang.
abstract final class LedgerEngine {
  static List<LedgerLine> linesFor(PostRequest request) {
    final amount = request.amount;
    if (!amount.isPositive) {
      throw const LedgerException(
        'amount_must_be_positive',
        'Nominal harus lebih besar dari nol.',
      );
    }

    final cash = request.cashAccountCode ?? AccountCode.kas.code;
    final kind = request.kind;
    if (_usesParty(kind)) {
      _requireParty(request.partyId);
    }

    return switch (kind) {
      EntryKind.modalAwal => [
          _debit(cash, amount),
          _credit(AccountCode.modal.code, amount),
        ],
      EntryKind.pemasukan => [
          _debit(cash, amount),
          _credit(_revenueTarget(request), amount),
        ],
      EntryKind.pengeluaran => [
          _debit(_expenseTarget(request), amount),
          _credit(cash, amount),
        ],
      EntryKind.penjualanTunai => [
          _debit(cash, amount),
          _credit(AccountCode.penjualan.code, amount),
          ..._costLines(request),
        ],
      EntryKind.penjualanKredit => [
          _debit(AccountCode.piutang.code, amount),
          _credit(AccountCode.penjualan.code, amount),
          ..._costLines(request),
        ],
      EntryKind.penerimaanPiutang => [
          _debit(cash, amount),
          _credit(AccountCode.piutang.code, amount),
        ],
      EntryKind.pembelianTunai => [
          _debit(AccountCode.persediaan.code, amount),
          _credit(cash, amount),
        ],
      EntryKind.pembelianKredit => [
          _debit(AccountCode.persediaan.code, amount),
          _credit(AccountCode.hutang.code, amount),
        ],
      EntryKind.pembayaranHutang => [
          _debit(AccountCode.hutang.code, amount),
          _credit(cash, amount),
        ],
      EntryKind.prive => [
          _debit(AccountCode.prive.code, amount),
          _credit(cash, amount),
        ],
    };
  }

  /// Jenis yang menyebut siapa lawannya, karena piutang dan hutang tidak bisa
  /// dibaca tanpa itu.
  static bool _usesParty(EntryKind kind) =>
      kind == EntryKind.penjualanKredit ||
      kind == EntryKind.penerimaanPiutang ||
      kind == EntryKind.pembelianKredit ||
      kind == EntryKind.pembayaranHutang;

  static String _revenueTarget(PostRequest request) => _requireType(
        request.targetAccountCode,
        AccountType.revenue,
        'Pilih sumber pendapatannya dulu.',
      );

  static String _expenseTarget(PostRequest request) => _requireType(
        request.targetAccountCode,
        AccountType.expense,
        'Pilih pos bebannya dulu.',
      );

  /// Membuat entri siap simpan, sekaligus menolak jurnal yang tidak seimbang.
  static LedgerEntry entry({
    required String id,
    required DateTime date,
    required PostRequest request,
  }) {
    final lines = linesFor(request);
    final entry = LedgerEntry(
      id: id,
      date: date,
      kindCode: request.kind.code,
      description: request.description,
      lines: lines,
      partyId: request.partyId,
      itemId: request.itemId,
      quantity: request.quantity,
      unitPrice: request.unitPrice,
      cashAccountCode: request.cashAccountCode ?? AccountCode.kas.code,
    );
    if (!entry.isBalanced) {
      throw const LedgerException(
        'unbalanced_entry',
        'Catatan ini tidak seimbang dan tidak disimpan.',
      );
    }
    return entry;
  }

  static List<LedgerLine> _costLines(PostRequest request) {
    final cost = request.cost;
    if (cost == null || cost.isZero) return const [];
    if (!cost.isPositive) {
      throw const LedgerException(
        'cost_must_be_positive',
        'Modal barang harus lebih besar dari nol.',
      );
    }
    return [
      _debit(AccountCode.hpp.code, cost),
      _credit(AccountCode.persediaan.code, cost),
    ];
  }

  static LedgerLine _debit(String code, Money amount) =>
      LedgerLine(accountCode: code, debit: amount);

  static LedgerLine _credit(String code, Money amount) =>
      LedgerLine(accountCode: code, credit: amount);

  static void _requireParty(String? partyId) {
    if (partyId == null || partyId.trim().isEmpty) {
      throw const LedgerException(
        'party_required',
        'Catat dulu ini urusan dengan siapa.',
      );
    }
  }

  static String _requireType(
    String? code,
    AccountType expected,
    String hint,
  ) {
    if (code == null || code.trim().isEmpty) {
      throw LedgerException('account_required', hint);
    }
    if (AccountCode.typeOfCode(code) != expected) {
      throw LedgerException(
        'account_type_mismatch',
        'Akun $code bukan ${expected.label}, jadi tidak bisa dipakai di sini.',
      );
    }
    return code;
  }
}

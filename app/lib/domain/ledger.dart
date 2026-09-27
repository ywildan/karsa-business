import '../core/money.dart';
import 'account.dart';

/// Satu sisi dari sebuah transaksi: debit ATAU kredit, tidak keduanya.
class LedgerLine {
  const LedgerLine({
    required this.accountCode,
    this.debit = Money.zero,
    this.credit = Money.zero,
  });

  final String accountCode;
  final Money debit;
  final Money credit;

  /// Selisih dilihat dari sisi debit.
  Money get net => debit - credit;

  /// Saldo sebagaimana akun itu dibaca manusia: aset dan beban membesar lewat
  /// debit, kewajiban/ekuitas/pendapatan lewat kredit.
  Money get balance {
    final type = AccountCode.typeOfCode(accountCode);
    return type.isDebitPositive ? net : -net;
  }

  @override
  String toString() => '$accountCode D${debit.rupees} K${credit.rupees}';
}

/// Kejadian transaksi beserta seluruh sisinya. Total debit dan kredit selalu
/// sama; yang melanggar tidak boleh sampai tersimpan.
class LedgerEntry {
  const LedgerEntry({
    required this.id,
    required this.date,
    required this.kindCode,
    required this.lines,
    this.description = '',
    this.partyId,
    this.itemId,
    this.quantity,
    this.unitPrice,
    this.cashAccountCode,
  });

  final String id;

  /// Tanggal kejadian; hanya tahun/bulan/tanggal yang dipakai.
  final DateTime date;
  final String kindCode;
  final String description;
  final List<LedgerLine> lines;
  final String? partyId;
  final String? itemId;
  final int? quantity;
  final int? unitPrice;
  final String? cashAccountCode;

  Money get totalDebit => lines.fold(Money.zero, (sum, l) => sum + l.debit);

  Money get totalCredit => lines.fold(Money.zero, (sum, l) => sum + l.credit);

  bool get isBalanced => totalDebit == totalCredit && !totalDebit.isZero;

  LedgerEntry copyWith({List<LedgerLine>? lines, String? description}) =>
      LedgerEntry(
        id: id,
        date: date,
        kindCode: kindCode,
        lines: lines ?? this.lines,
        description: description ?? this.description,
        partyId: partyId,
        itemId: itemId,
        quantity: quantity,
        unitPrice: unitPrice,
        cashAccountCode: cashAccountCode,
      );
}

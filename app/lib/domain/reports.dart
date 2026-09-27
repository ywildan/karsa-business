import '../core/money.dart';
import 'account.dart';
import 'ledger.dart';

/// Ringkasan satu akun dalam sebuah rentang waktu.
class AccountSummary {
  const AccountSummary({
    required this.accountCode,
    required this.debit,
    required this.credit,
  });

  final String accountCode;
  final Money debit;
  final Money credit;

  AccountType get type => AccountCode.typeOfCode(accountCode);

  /// Saldo dari sudut pandang akunnya, bukan sudut pandang debit.
  Money get balance {
    final net = debit - credit;
    return type.isDebitPositive ? net : -net;
  }

  @override
  String toString() => '$accountCode ${balance.rupees}';
}

class DailyCash {
  const DailyCash({required this.day, required this.inflow, required this.outflow});

  final DateTime day;
  final Money inflow;
  final Money outflow;

  Money get net => inflow - outflow;
}

class ProfitAndLoss {
  const ProfitAndLoss({required this.revenue, required this.expense});

  final Money revenue;
  final Money expense;

  Money get profit => revenue - expense;

  /// Persen, dibulatkan ke terdekat. Nol kalau belum ada penjualan.
  int get marginPercent => revenue.isZero
      ? 0
      : (profit.rupees * 100 / revenue.rupees).round();
}

/// Laporan dihitung dari jurnal, tidak pernah dari angka yang diketik ulang.
abstract final class Reports {
  static List<AccountSummary> byAccount(
    Iterable<LedgerEntry> entries, {
    DateTime? from,
    DateTime? to,
    AccountType? type,
  }) {
    final debit = <String, int>{};
    final credit = <String, int>{};

    for (final entry in entries) {
      if (!_inRange(entry.date, from, to)) continue;
      for (final line in entry.lines) {
        if (type != null && AccountCode.typeOfCode(line.accountCode) != type) {
          continue;
        }
        debit[line.accountCode] =
            (debit[line.accountCode] ?? 0) + line.debit.rupees;
        credit[line.accountCode] =
            (credit[line.accountCode] ?? 0) + line.credit.rupees;
      }
    }

    final codes = <String>{...debit.keys, ...credit.keys}.toList()..sort();
    return [
      for (final code in codes)
        AccountSummary(
          accountCode: code,
          debit: Money(debit[code] ?? 0),
          credit: Money(credit[code] ?? 0),
        ),
    ];
  }

  static Money balanceOf(
    Iterable<LedgerEntry> entries,
    AccountType type, {
    DateTime? from,
    DateTime? to,
  }) {
    var total = 0;
    for (final row in byAccount(entries, from: from, to: to, type: type)) {
      total += row.balance.rupees;
    }
    return Money(total);
  }

  static Money balanceOfCode(
    Iterable<LedgerEntry> entries,
    String accountCode, {
    DateTime? from,
    DateTime? to,
  }) {
    var total = 0;
    for (final row in byAccount(entries, from: from, to: to)) {
      if (row.accountCode == accountCode) total += row.balance.rupees;
    }
    return Money(total);
  }

  static ProfitAndLoss profitAndLoss(
    Iterable<LedgerEntry> entries, {
    DateTime? from,
    DateTime? to,
  }) {
    return ProfitAndLoss(
      revenue: balanceOf(entries, AccountType.revenue, from: from, to: to),
      expense: balanceOf(entries, AccountType.expense, from: from, to: to),
    );
  }

  /// Arus kas harian: hanya sisi yang menyentuh akun kas.
  static List<DailyCash> cashFlowByDay(
    Iterable<LedgerEntry> entries, {
    String cashAccountCode = '1100',
    DateTime? from,
    DateTime? to,
  }) {
    final inflow = <DateTime, int>{};
    final outflow = <DateTime, int>{};

    for (final entry in entries) {
      if (!_inRange(entry.date, from, to)) continue;
      final day = _dateOnly(entry.date);
      for (final line in entry.lines) {
        if (line.accountCode != cashAccountCode) continue;
        inflow[day] = (inflow[day] ?? 0) + line.debit.rupees;
        outflow[day] = (outflow[day] ?? 0) + line.credit.rupees;
      }
    }

    final days = <DateTime>{...inflow.keys, ...outflow.keys}.toList()
      ..sort();
    return [
      for (final day in days)
        DailyCash(
          day: day,
          inflow: Money(inflow[day] ?? 0),
          outflow: Money(outflow[day] ?? 0),
        ),
    ];
  }

  /// Neraca saldo: total debit harus sama dengan total kredit.
  static bool trialBalanceBalances(
    Iterable<LedgerEntry> entries, {
    DateTime? from,
    DateTime? to,
  }) {
    var debit = 0;
    var credit = 0;
    for (final row in byAccount(entries, from: from, to: to)) {
      debit += row.debit.rupees;
      credit += row.credit.rupees;
    }
    return debit == credit;
  }

  static bool _inRange(DateTime date, DateTime? from, DateTime? to) {
    final day = _dateOnly(date);
    if (from != null && day.isBefore(_dateOnly(from))) return false;
    if (to != null && day.isAfter(_dateOnly(to))) return false;
    return true;
  }

  static DateTime _dateOnly(DateTime value) =>
      DateTime(value.year, value.month, value.day);
}

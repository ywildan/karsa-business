import 'package:flutter_test/flutter_test.dart';
import 'package:karsa_business/core/money.dart';
import 'package:karsa_business/domain/account.dart';
import 'package:karsa_business/domain/ledger.dart';
import 'package:karsa_business/domain/ledger_engine.dart';
import 'package:karsa_business/domain/reports.dart';

LedgerEntry post(String id, DateTime date, PostRequest request) =>
    LedgerEngine.entry(id: id, date: date, request: request);

void main() {
  late List<LedgerEntry> books;

  setUp(() {
    books = [
      post(
        '1',
        DateTime(2026, 9, 1),
        const PostRequest(kind: EntryKind.modalAwal, amount: Money(300000)),
      ),
      post(
        '2',
        DateTime(2026, 9, 2),
        const PostRequest(
          kind: EntryKind.penjualanTunai,
          amount: Money(25000),
          cost: Money(10000),
          description: 'Jualan hari pertama',
        ),
      ),
      post(
        '3',
        DateTime(2026, 9, 3),
        const PostRequest(
          kind: EntryKind.pengeluaran,
          amount: Money(5000),
          targetAccountCode: '6200',
          description: 'Beli telur',
        ),
      ),
      post(
        '4',
        DateTime(2026, 9, 4),
        const PostRequest(
          kind: EntryKind.penjualanKredit,
          amount: Money(20000),
          partyId: 'rina',
        ),
      ),
      post(
        '5',
        DateTime(2026, 9, 5),
        const PostRequest(
          kind: EntryKind.penerimaanPiutang,
          amount: Money(10000),
          partyId: 'rina',
        ),
      ),
    ];
  });

  test('neraca saldo selalu seimbang', () {
    expect(Reports.trialBalanceBalances(books), isTrue);
  });

  test('saldo dibaca dari sisi akun yang benar', () {
    expect(Reports.balanceOfCode(books, AccountCode.kas.code), Money(330000));
    expect(
      Reports.balanceOfCode(books, AccountCode.piutang.code),
      Money(10000),
    );
    expect(
      Reports.balanceOfCode(books, AccountCode.persediaan.code),
      Money(-10000),
    );
    expect(Reports.balanceOfCode(books, AccountCode.modal.code), Money(300000));
  });

  test('laba rugi bukan sama dengan sisa uang di kas', () {
    final pl = Reports.profitAndLoss(books);
    expect(pl.revenue, Money(45000));
    expect(pl.expense, Money(15000));
    expect(pl.profit, Money(30000));
    expect(pl.marginPercent, 67);
    expect(
      Reports.balanceOfCode(books, AccountCode.kas.code),
      isNot(pl.profit),
    );
  });

  test('aset = kewajiban + modal + laba', () {
    final assets = Reports.balanceOf(books, AccountType.asset);
    final liabilities = Reports.balanceOf(books, AccountType.liability);
    final equity = Reports.balanceOf(books, AccountType.equity);
    final pl = Reports.profitAndLoss(books);
    expect(assets, liabilities + equity + pl.profit);
  });

  test(
    'arus kas harian hanya memuat hari ketika uang benar-benar bergerak',
    () {
      final flow = Reports.cashFlowByDay(books);
      expect(flow.map((day) => day.day.day).toList(), [1, 2, 3, 5]);
      expect(flow.first.inflow, Money(300000));
      expect(flow[2].outflow, Money(5000));
      expect(flow.last.net, Money(10000));
      expect(
        flow.fold<Money>(Money.zero, (sum, day) => sum + day.net),
        Money(330000),
      );
    },
  );

  test('penjualan belum dibayar tidak menggerakkan kas', () {
    expect(Reports.cashFlowByDay([books[3]]), isEmpty);
  });

  test('rentang waktu memotong transaksi di luarnya', () {
    final twoDays = Reports.profitAndLoss(
      books,
      from: DateTime(2026, 9, 2),
      to: DateTime(2026, 9, 3),
    );
    expect(twoDays.revenue, Money(25000));
    expect(twoDays.expense, Money(15000));
    expect(twoDays.profit, Money(10000));
  });

  test('batas rentang dihitung termasuk hari pertamanya sendiri', () {
    final oneDay = Reports.cashFlowByDay(
      books,
      from: DateTime(2026, 9, 3),
      to: DateTime(2026, 9, 3, 17, 30),
    );
    expect(oneDay.length, 1);
    expect(oneDay.first.outflow, Money(5000));
  });

  test('akun dikelompokkan sesuai jenisnya', () {
    expect(
      Reports.byAccount(
        books,
        type: AccountType.expense,
      ).map((row) => row.accountCode).toList(),
      [AccountCode.hpp.code, AccountCode.bebanOperasional.code],
    );
  });

  test('buku kosong menghasilkan nol, bukan galat', () {
    expect(Reports.profitAndLoss([]).profit, Money.zero);
    expect(Reports.profitAndLoss([]).marginPercent, 0);
    expect(Reports.cashFlowByDay([]), isEmpty);
    expect(Reports.byAccount([]), isEmpty);
    expect(Reports.trialBalanceBalances([]), isTrue);
  });
}

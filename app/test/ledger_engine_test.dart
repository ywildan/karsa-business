import 'package:flutter_test/flutter_test.dart';
import 'package:karsa_business/core/money.dart';
import 'package:karsa_business/domain/account.dart';
import 'package:karsa_business/domain/ledger.dart';
import 'package:karsa_business/domain/ledger_engine.dart';

const amount = Money(100000);

PostRequest requestFor(EntryKind kind) => switch (kind) {
  EntryKind.pemasukan => PostRequest(
    kind: kind,
    amount: amount,
    targetAccountCode: '5900',
  ),
  EntryKind.pengeluaran => PostRequest(
    kind: kind,
    amount: amount,
    targetAccountCode: '6200',
  ),
  EntryKind.penjualanKredit ||
  EntryKind.penerimaanPiutang ||
  EntryKind.pembelianKredit ||
  EntryKind.pembayaranHutang => PostRequest(
    kind: kind,
    amount: amount,
    partyId: 'pihak-1',
  ),
  EntryKind.modalAwal ||
  EntryKind.penjualanTunai ||
  EntryKind.pembelianTunai ||
  EntryKind.prive => PostRequest(kind: kind, amount: amount),
};

void main() {
  group('mesin jurnal', () {
    test('setiap jenis transaksi menghasilkan jurnal yang seimbang', () {
      for (final kind in EntryKind.values) {
        final lines = LedgerEngine.linesFor(requestFor(kind));
        final debit = lines.fold<Money>(Money.zero, (sum, l) => sum + l.debit);
        final credit = lines.fold<Money>(
          Money.zero,
          (sum, l) => sum + l.credit,
        );
        expect(debit, credit, reason: 'tidak seimbang: ${kind.code}');
        expect(debit.isPositive, isTrue, reason: 'nominal nol: ${kind.code}');
      }
    });

    test('modal awal menaikkan kas, bukan pendapatan', () {
      final lines = LedgerEngine.linesFor(
        const PostRequest(kind: EntryKind.modalAwal, amount: Money(300000)),
      );
      expect(lines.length, 2);
      expect(lines[0].accountCode, AccountCode.kas.code);
      expect(lines[0].debit, Money(300000));
      expect(lines[1].accountCode, AccountCode.modal.code);
      expect(lines[1].credit, Money(300000));
    });

    test('jualan belum dibayar menyentuh piutang, tidak menyentuh kas', () {
      final lines = LedgerEngine.linesFor(
        const PostRequest(
          kind: EntryKind.penjualanKredit,
          amount: Money(25000),
          partyId: 'rina',
        ),
      );
      expect(lines[0].accountCode, AccountCode.piutang.code);
      expect(lines[0].debit, Money(25000));
      expect(lines[1].accountCode, AccountCode.penjualan.code);
      expect(lines[1].credit, Money(25000));
      expect(
        lines.any((line) => line.accountCode == AccountCode.kas.code),
        isFalse,
      );
    });

    test('penjualan ber-stok menambah sepasang sisi harga pokok', () {
      final lines = LedgerEngine.linesFor(
        const PostRequest(
          kind: EntryKind.penjualanTunai,
          amount: Money(25000),
          cost: Money(10000),
        ),
      );
      expect(lines.length, 4);
      expect(
        lines.map((line) => line.accountCode),
        containsAll(<String>[
          AccountCode.hpp.code,
          AccountCode.persediaan.code,
        ]),
      );
      final hpp = lines.firstWhere(
        (l) => l.accountCode == AccountCode.hpp.code,
      );
      final stok = lines.firstWhere(
        (l) => l.accountCode == AccountCode.persediaan.code,
      );
      expect(hpp.debit, Money(10000));
      expect(stok.credit, Money(10000));
    });

    test('satu usaha boleh memakai akun kas lain', () {
      final lines = LedgerEngine.linesFor(
        const PostRequest(
          kind: EntryKind.pengeluaran,
          amount: Money(5000),
          targetAccountCode: '6200',
          cashAccountCode: '1150',
        ),
      );
      expect(lines[1].accountCode, '1150');
      expect(lines[1].credit, Money(5000));
    });

    test('nominal nol dan negatif ditolak', () {
      expect(
        () => LedgerEngine.linesFor(
          const PostRequest(kind: EntryKind.modalAwal, amount: Money(0)),
        ),
        throwsLedger('amount_must_be_positive'),
      );
      expect(
        () => LedgerEngine.linesFor(
          const PostRequest(kind: EntryKind.modalAwal, amount: Money(-1000)),
        ),
        throwsLedger('amount_must_be_positive'),
      );
    });

    test('transisi kredit wajib menyebut siapa lawannya', () {
      for (final kind in <EntryKind>[
        EntryKind.penjualanKredit,
        EntryKind.penerimaanPiutang,
        EntryKind.pembelianKredit,
        EntryKind.pembayaranHutang,
      ]) {
        expect(
          () => LedgerEngine.linesFor(PostRequest(kind: kind, amount: amount)),
          throwsLedger('party_required'),
          reason: kind.code,
        );
      }
    });

    test('pemasukan dan pengeluaran wajib menunjuk akun yang cocok', () {
      expect(
        () => LedgerEngine.linesFor(
          const PostRequest(kind: EntryKind.pengeluaran, amount: amount),
        ),
        throwsLedger('account_required'),
      );
      expect(
        () => LedgerEngine.linesFor(
          const PostRequest(
            kind: EntryKind.pengeluaran,
            amount: amount,
            targetAccountCode: '5100',
          ),
        ),
        throwsLedger('account_type_mismatch'),
      );
      expect(
        () => LedgerEngine.linesFor(
          const PostRequest(
            kind: EntryKind.pemasukan,
            amount: amount,
            targetAccountCode: '6200',
          ),
        ),
        throwsLedger('account_type_mismatch'),
      );
    });

    test('modal barang yang negatif ditolak', () {
      expect(
        () => LedgerEngine.linesFor(
          const PostRequest(
            kind: EntryKind.penjualanTunai,
            amount: amount,
            cost: Money(-1),
          ),
        ),
        throwsLedger('cost_must_be_positive'),
      );
    });

    test('sub-akan buatan pengguna dikenali jenisnya dari digit pertama', () {
      expect(AccountCode.typeOfCode('6200.01'), AccountType.expense);
      expect(AccountCode.typeOfCode('5100.2'), AccountType.revenue);
      expect(AccountCode.typeOfCode('1300'), AccountType.asset);
      final lines = LedgerEngine.linesFor(
        const PostRequest(
          kind: EntryKind.pengeluaran,
          amount: amount,
          targetAccountCode: '6200.01',
        ),
      );
      expect(lines.first.accountCode, '6200.01');
    });
  });

  group('entri siap simpan', () {
    test('menyimpan kode jenis dan akun kas yang dipakai', () {
      final entry = LedgerEngine.entry(
        id: 'entri-1',
        date: DateTime(2026, 9, 3),
        request: const PostRequest(
          kind: EntryKind.pengeluaran,
          amount: Money(5000),
          targetAccountCode: '6200',
          description: 'Beli telur',
        ),
      );
      expect(entry.id, 'entri-1');
      expect(entry.kindCode, 'pengeluaran');
      expect(entry.cashAccountCode, AccountCode.kas.code);
      expect(entry.description, 'Beli telur');
      expect(entry.isBalanced, isTrue);
      expect(entry.totalDebit, Money(5000));
    });

    test('jurnal rakitan tangan yang tidak seimbang ditandai tidak sah', () {
      final entry = LedgerEntry(
        id: 'cacat',
        date: DateTime(2026, 9, 3),
        kindCode: 'pengeluaran',
        lines: const [
          LedgerLine(
            accountCode: '6200',
            debit: Money(5000),
            credit: Money(1000),
          ),
        ],
      );
      expect(entry.isBalanced, isFalse);
    });
  });

  group('kode jenis', () {
    test('kembali terbaca dari teks yang disimpan', () {
      for (final kind in EntryKind.values) {
        expect(EntryKind.fromCode(kind.code), kind);
      }
      expect(EntryKind.fromCode('tidak_ada'), isNull);
    });
  });
}

/// Memastikan kegagalan yang diharapkan berasal dari mesin jurnal, bukan dari
/// kesalahan lain yang kebetulan melempar.
Matcher throwsLedger(String code) =>
    throwsA(isA<LedgerException>().having((e) => e.code, 'code', code));

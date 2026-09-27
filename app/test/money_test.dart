import 'package:flutter_test/flutter_test.dart';
import 'package:karsa_business/core/money.dart';

void main() {
  group('penulisan angka', () {
    test('memisahkan ribuan dengan titik', () {
      expect(Money(0).toString(), 'Rp 0');
      expect(Money(123).toString(), 'Rp 123');
      expect(Money(1234).toString(), 'Rp 1.234');
      expect(Money(25000).toString(), 'Rp 25.000');
      expect(Money(1000000).toString(), 'Rp 1.000.000');
      expect(Money(100000000).toString(), 'Rp 100.000.000');
    });

    test('tanda minus dibaca di depan, bukan di antara angka', () {
      expect(Money(-1000).toString(), '-Rp 1.000');
      expect(Money(-1234567).toString(), '-Rp 1.234.567');
    });
  });

  group('aritmetika', () {
    test('penjumlahan, pengurangan, dan perkalian', () {
      expect(Money(25000) + Money(5000), Money(30000));
      expect(Money(25000) - Money(30000), Money(-5000));
      expect(Money(15000) * 3, Money(45000));
      expect(-Money(15000), Money(-15000));
    });

    test('perbandingan memakai nilai, bukan identitas objek', () {
      expect(Money(25000) > Money(5000), isTrue);
      expect(Money(25000) < Money(5000), isFalse);
      expect(Money(25000) <= Money(25000), isTrue);
      expect(Money(25000) >= Money(25000), isTrue);
      expect(Money(25000) == Money(25000), isTrue);
      expect(Money(0).isZero, isTrue);
      expect(Money(1).isPositive, isTrue);
      expect(Money(-1).isNegative, isTrue);
    });

    test('nilai yang sama menempati satu tempat di himpunan', () {
      expect({const Money(100), const Money(100)}.length, 1);
    });

    test('bisa diurutkan', () {
      final sorted = [Money(300), Money(-5), Money(20)]..sort();
      expect(sorted, [Money(-5), Money(20), Money(300)]);
    });
  });

  group('ketikan pengguna', () {
    test('titik ribuan, angka polos, dan awalan Rp sama-sama diterima', () {
      expect(Money.tryParse('25.000'), Money(25000));
      expect(Money.tryParse('25000'), Money(25000));
      expect(Money.tryParse('Rp 25.000'), Money(25000));
      expect(Money.tryParse('rp25.000'), Money(25000));
      expect(Money.tryParse('1.000.000'), Money(1000000));
      expect(Money.tryParse('  500 '), Money(500));
      expect(Money.tryParse('0'), Money(0));
    });

    test('koma diperlakukan sebagai pecahan lalu dibulatkan', () {
      expect(Money.tryParse('25,5'), Money(26));
      expect(Money.tryParse('1.234,56'), Money(1235));
    });

    test('yang bukan angka ditolak, tidak dianggap nol', () {
      expect(Money.tryParse(''), isNull);
      expect(Money.tryParse('   '), isNull);
      expect(Money.tryParse('abc'), isNull);
      expect(Money.tryParse('25.000 rupiah'), isNull);
      expect(Money.tryParse('.'), isNull);
    });
  });
}

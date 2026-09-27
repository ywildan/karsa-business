/// Jenis akun menentukan sisi mana yang menambah saldo.
enum AccountType {
  asset('aset', true),
  liability('kewajiban', false),
  equity('ekuitas', false),
  revenue('pendapatan', false),
  expense('beban', true);

  const AccountType(this.label, this.isDebitPositive);

  final String label;
  final bool isDebitPositive;
}

/// Nomor akun baku. Angka pertama menentukan jenisnya, sehingga pengguna boleh
/// menambah sub-akan sendiri — `6200.01` tetap terbaca sebagai beban.
enum AccountCode {
  kas('1100', 'Kas'),
  bank('1150', 'Bank'),
  piutang('1200', 'Piutang Usaha'),
  persediaan('1300', 'Persediaan'),
  hutang('2100', 'Hutang Usaha'),
  modal('3100', 'Modal Pemilik'),
  prive('3200', 'Prive'),
  penjualan('5100', 'Penjualan'),
  returPenjualan('5190', 'Retur Penjualan'),
  pendapatanLain('5900', 'Pendapatan Lain'),
  hpp('6100', 'Harga Pokok Penjualan'),
  bebanOperasional('6200', 'Beban Operasional');

  const AccountCode(this.code, this.label);

  final String code;
  final String label;

  AccountType get type => typeOfCode(code);

  /// Digit pertama nomor akun menentukan jenisnya.
  static AccountType typeOfCode(String code) {
    final digit = code.trim().isEmpty ? '' : code.trim()[0];
    switch (digit) {
      case '1':
        return AccountType.asset;
      case '2':
        return AccountType.liability;
      case '3':
        return AccountType.equity;
      case '5':
        return AccountType.revenue;
      case '6':
        return AccountType.expense;
      default:
        return AccountType.asset;
    }
  }

  static AccountCode? fromCode(String code) {
    for (final account in AccountCode.values) {
      if (account.code == code) return account;
    }
    return null;
  }
}

/// Bagan akun yang ditaburkan ke setiap usaha baru.
abstract final class ChartOfAccounts {
  /// Sembilan pos yang pasti dipakai siapa pun yang mencatat: tanpa salah
  /// satunya, piutang atau harga pokok tidak punya tempat jatuh.
  static const List<AccountCode> seed = [
    AccountCode.kas,
    AccountCode.piutang,
    AccountCode.persediaan,
    AccountCode.hutang,
    AccountCode.modal,
    AccountCode.prive,
    AccountCode.penjualan,
    AccountCode.hpp,
    AccountCode.bebanOperasional,
  ];

  /// Tidak ditaburkan sendiri: tidak setiap usaha punya rekening bank atau
  /// menerima barang kembali.
  static const List<AccountCode> optional = [
    AccountCode.bank,
    AccountCode.returPenjualan,
    AccountCode.pendapatanLain,
  ];

  static List<String> get seedCodes => [for (final a in seed) a.code];

  /// Pos semaian menahan laporan tetap terbaca, jadi tidak bisa dihapus.
  static bool isSeeded(String code) => seed.any((a) => a.code == code);
}

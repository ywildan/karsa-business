/// Jumlah uang dalam satuan rupiah utuh.
///
/// Rupiah tidak punya pecahan yang masih berarti dalam pencatatan usaha kecil,
/// jadi menyimpannya sebagai `int` menghapus kelas kesalahan pembulatan yang
/// paling sering muncul di aplikasi keuangan buatan sendiri.
class Money implements Comparable<Money> {
  const Money(this.rupees);

  static const Money zero = Money(0);

  final int rupees;

  bool get isZero => rupees == 0;
  bool get isPositive => rupees > 0;
  bool get isNegative => rupees < 0;

  Money operator +(Money other) => Money(rupees + other.rupees);
  Money operator -(Money other) => Money(rupees - other.rupees);
  Money operator *(int factor) => Money(rupees * factor);
  Money operator -() => Money(-rupees);

  bool operator <(Money other) => rupees < other.rupees;
  bool operator >(Money other) => rupees > other.rupees;
  bool operator <=(Money other) => rupees <= other.rupees;
  bool operator >=(Money other) => rupees >= other.rupees;

  @override
  int compareTo(Money other) => rupees.compareTo(other.rupees);

  @override
  bool operator ==(Object other) => other is Money && other.rupees == rupees;

  @override
  int get hashCode => rupees.hashCode;

  @override
  String toString() => isNegative ? '-Rp ${group(rupees.abs())}' : 'Rp ${group(rupees)}';

  /// `25000` menjadi `25.000`, tanpa tanda minus.
  static String group(int value) {
    final digits = value.abs().toString();
    final lead = digits.length % 3;
    final out = StringBuffer();
    for (var i = 0; i < digits.length; i++) {
      if (i > 0 && (i - lead) % 3 == 0) out.write('.');
      out.write(digits[i]);
    }
    return out.toString();
  }

  /// Menerima ketikan pengguna: `25.000`, `25000`, `Rp 25.000`, `25,5`.
  ///
  /// Pecahan dibulatkan ke rupiah terdekat karena satuan itu tidak dipakai.
  static Money? tryParse(String input) {
    var text = input.trim();
    if (text.isEmpty) return null;
    if (text.length > 2 && text.substring(0, 2).toUpperCase() == 'RP') {
      text = text.substring(2);
    }
    text = text.replaceAll(RegExp(r'\s'), '');
    if (text.contains(',')) {
      text = text.replaceAll('.', '').replaceAll(',', '.');
    } else {
      text = text.replaceAll('.', '');
    }
    final value = double.tryParse(text);
    if (value == null) return null;
    return Money(value.round());
  }
}

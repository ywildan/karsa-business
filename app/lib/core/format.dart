/// Tanggal dan nama bulan dalam bahasa Indonesia.
///
/// Yang dibutuhkan aplikasi ini cuma sembilan nama bulan dan tujuh nama hari,
/// jadi tidak ada alasan membawa katalog internasionalisasi penuh: setiap
/// label yang salah tulis di sini akan terlihat oleh mata, bukan oleh tes.
library;

const List<String> kMonthNames = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

const List<String> kMonthShortNames = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

/// Urut seperti [DateTime.weekday]: Senin pertama.
const List<String> kDayShortNames = [
  'Sen',
  'Sel',
  'Rab',
  'Kam',
  'Jum',
  'Sab',
  'Min',
];

String dayAndMonth(DateTime date) =>
    '${date.day} ${kMonthShortNames[date.month - 1]}';

String shortDate(DateTime date) => '${dayAndMonth(date)} ${date.year}';

String monthLabel(DateTime date) =>
    '${kMonthNames[date.month - 1]} ${date.year}';

String fullDate(DateTime date) =>
    '${kDayShortNames[date.weekday - 1]}, ${shortDate(date)}';

/// Awal bulan, tanpa jam.
DateTime startOfMonth(DateTime date) => DateTime(date.year, date.month);

/// Bulan berikutnya. `DateTime` menerima bulan ke-13, jadi Desember tidak
/// perlu ditangani khusus.
DateTime nextMonth(DateTime date) => DateTime(date.year, date.month + 1);

/// Hari terakhir bulan ini, dipakai sebagai batas atas yang ikut terbaca di
/// laporan: tanggal 0 berarti hari terakhir bulan sebelumnya.
DateTime endOfMonth(DateTime date) => DateTime(date.year, date.month + 1, 0);

/// [count] hari terakhir, diurutkan dari yang paling tua dan berakhir hari ini.
List<DateTime> lastDays(int count, {DateTime? today}) {
  final end = _dayOnly(today ?? DateTime.now());
  return [
    for (var i = count - 1; i >= 0; i--)
      DateTime(end.year, end.month, end.day - i),
  ];
}

DateTime _dayOnly(DateTime date) => DateTime(date.year, date.month, date.day);

/// Perbandingan dua tanggal pada level hari saja: jurnal menyimpan kejadian
/// pada hari, bukan pada jam.
bool isSameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

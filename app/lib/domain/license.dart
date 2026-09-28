/// Bentuk kode lisensi dan keputusan apakah fitur lanjutan boleh dibuka.
///
/// Murni Dart: tidak menyimpan apa pun, tidak memanggil jaringan, tidak
/// mengimpor flutter. Dua hal di sini yang bisa salah dan mahal kalau salah —
/// alfabet kode dan hitungan toleransi offline — diuji di job validate satu
/// menit, jauh sebelum ada Worker yang bisa ditipu.
library;

/// Edisi yang diketahui sebuah perangkat, hasil verifikasi.
enum Edition {
  free,
  pro,
}

/// Isi balasan `POST /license/verify`, dipakai bersama cap waktu lokal.
class LicenseTicket {
  const LicenseTicket({
    required this.token,
    required this.edition,
    required this.checkedAtMicros,
    required this.validUntilMicros,
  });

  /// Kunci satu-satunya untuk sinkron. Bukan `owner_id`: itulah kenapa
  /// balasan server membawa token, bukan hanya identitas pemilik.
  final String token;

  final Edition edition;

  /// Kapan hp ini terakhir berhasil bicara dengan server.
  final int checkedAtMicros;

  /// Akhir masa berlaku menurut server, bukan menurut hp.
  final int validUntilMicros;
}

/// Posisi satu perangkat terhadap fitur lanjutan, saat ini.
enum LicenseState {
  /// Verifikasi masih segar; tidak perlu jaringan.
  fresh,

  /// Fitur masih dibuka, tapi hp ini sudah hutang satu kali cek ulang.
  grace,

  /// Fitur ditutup sampai verifikasi berhasil lagi.
  locked,
}

abstract final class LicenseCode {
  static const String prefix = 'KRSB';

  /// Kelompok karakter setelah prefiks. Dua kelompok empat karakter, sama
  /// seperti contoh yang dipakai halaman Lisensi.
  static const int groups = 2;
  static const int groupLength = 4;

  /// Base32 Crockford: tanpa I, L, O, U. Kode lisensi dibacakan lewat chat dan
  /// diketik di layar hp, jadi huruf yang mudah tertukar bukan kesalahan kecil
  /// — ia jadi tiket dukungan. Delapan karakter dari 32 lambang adalah 2^40
  /// kemungkinan, dan server membatasinya lagi lewat laju per kode.
  static const String alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

  static final Set<String> _letters = {for (final c in alphabet.split('')) c};

  /// Bentuk baku dari apa pun yang pengguna ketik, atau null kalau tidak
  /// mungkin sebuah kode. Spasi, titik, garis dan huruf kecil semua diterima;
  /// yang tidak diterima adalah karakter di luar alfabet dan panjang yang
  /// salah, supaya typo tertahan di halaman ini, bukan di antrean server.
  static String? normalize(String input) {
    final compact = input.toUpperCase().replaceAll(RegExp('[^A-Z0-9]'), '');
    if (!compact.startsWith(prefix)) return null;
    final body = compact.substring(prefix.length);
    if (body.length != groups * groupLength) return null;
    if (!_letters.containsAll(body.split(''))) return null;
    final parts = <String>[prefix];
    for (var i = 0; i < body.length; i += groupLength) {
      parts.add(body.substring(i, i + groupLength));
    }
    return parts.join('-');
  }
}

abstract final class LicenseGate {
  static const int microsPerDay = 24 * 60 * 60 * 1000000;

  /// Sesering ini hp diminta bicara lagi dengan server.
  static const int recheckAfterMicros = 7 * microsPerDay;

  /// Selama ini fitur tetap terbuka tanpa jaringan, dihitung dari cek terakhir
  /// yang berhasil.
  static const int offlineGraceMicros = 14 * microsPerDay;

  /// Jam tertinggi yang pernah dilihat. Dipakai alih-alih jam sekarang supaya
  /// memundurkan jam perangkat tidak memperpanjang tenggat apa pun — sama
  /// seperti rev server yang menentukan urutan catatan, bukan jam hp.
  static int bestClock(int seenMicros, int nowMicros) =>
      nowMicros > seenMicros ? nowMicros : seenMicros;

  /// Keputusan pembuka fitur. Tiga ambang, semuanya dibanding [bestClock].
  static LicenseState stateOf({
    required LicenseTicket? ticket,
    required int seenMicros,
    required int nowMicros,
  }) {
    if (ticket == null || ticket.edition != Edition.pro) {
      return LicenseState.locked;
    }
    final clock = bestClock(seenMicros, nowMicros);
    if (clock > ticket.validUntilMicros) return LicenseState.locked;
    if (clock > ticket.checkedAtMicros + offlineGraceMicros) {
      return LicenseState.locked;
    }
    if (clock > ticket.checkedAtMicros + recheckAfterMicros) {
      return LicenseState.grace;
    }
    return LicenseState.fresh;
  }

  /// Gerbang yang dibaca antarmuka: fitur lanjutan tampil atau tidak.
  static bool allowsPro({
    required LicenseTicket? ticket,
    required int seenMicros,
    required int nowMicros,
  }) =>
      stateOf(
        ticket: ticket,
        seenMicros: seenMicros,
        nowMicros: nowMicros,
      ) !=
      LicenseState.locked;
}

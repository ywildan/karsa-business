import 'package:flutter_test/flutter_test.dart';
import 'package:karsa_business/domain/license.dart';

const _day = LicenseGate.microsPerDay;

/// Satu titik waktu, supaya yang dibaca di bawah hanya selisih harinya.
const _t0 = 1761955200000000;

LicenseTicket _pro({int checkedAt = _t0, int? validAfterDays}) {
  return LicenseTicket(
    token: 'token-pemilik',
    edition: Edition.pro,
    checkedAtMicros: checkedAt,
    validUntilMicros: _t0 + (validAfterDays ?? 365) * _day,
  );
}

LicenseState _state({
  LicenseTicket? ticket,
  int afterDays = 0,
  int? seenAfterDays,
}) {
  return LicenseGate.stateOf(
    ticket: ticket,
    seenMicros: _t0 + (seenAfterDays ?? 0) * _day,
    nowMicros: _t0 + afterDays * _day,
  );
}

void main() {
  group('bentuk kode', () {
    test('contoh yang tercetak di dokumen diterima apa adanya', () {
      expect(LicenseCode.normalize('KRSB-7QF2-M4XN'), 'KRSB-7QF2-M4XN');
    });

    test('huruf kecil, spasi, titik dan tanpa garis diseragamkan', () {
      const input = [
        'krsb-7qf2-m4xn',
        'KRSB 7QF2 M4XN',
        'KRSB.7QF2.M4XN',
        'KRSB7QF2M4XN',
        '  krsb_7qf2-m4xn ',
      ];
      for (final raw in input) {
        expect(LicenseCode.normalize(raw), 'KRSB-7QF2-M4XN', reason: raw);
      }
    });

    test('hasil normalisasi stabil kalau dinormalisasi lagi', () {
      const input = ['krsb 7qf2 m4xn', 'KRSB---7QF2---M4XN'];
      for (final raw in input) {
        final once = LicenseCode.normalize(raw);
        expect(LicenseCode.normalize(once!), once, reason: raw);
      }
    });

    test('huruf yang mudah tertukar ditolak di halaman ini', () {
      for (final letter in ['I', 'L', 'O', 'U']) {
        expect(
          LicenseCode.normalize('KRSB-7QF2-M4X$letter'),
          isNull,
          reason: letter,
        );
      }
    });

    test('prefiks dan panjang yang salah ditolak', () {
      const input = [
        '',
        'KRSB',
        'KRSA-7QF2-M4XN',
        'KRSB-7QF2-M4X',
        'KRSB-7QF2-M4XNN',
        '7QF2-M4XN',
        'KRSB-7QF2-M4XN-9',
        'krsb-seven-qf2x',
      ];
      for (final raw in input) {
        expect(LicenseCode.normalize(raw), isNull, reason: raw);
      }
    });

    test('alfabet utuh, tanpa duplikat, tanpa huruf yang bermasalah', () {
      expect(LicenseCode.alphabet, hasLength(32));
      expect(LicenseCode.alphabet.split('').toSet(), hasLength(32));
      for (final letter in ['I', 'L', 'O', 'U']) {
        expect(LicenseCode.alphabet.contains(letter), isFalse, reason: letter);
      }
    });
  });

  group('keputusan pembuka fitur', () {
    test('belum pernah verifikasi mengunci', () {
      expect(_state(), LicenseState.locked);
    });

    test('tiket edisi gratis mengunci', () {
      const ticket = LicenseTicket(
        token: 'token',
        edition: Edition.free,
        checkedAtMicros: _t0,
        validUntilMicros: _t0 + 365 * _day,
      );
      expect(_state(ticket: ticket), LicenseState.locked);
    });

    test('tujuh hari pertama tidak butuh jaringan', () {
      for (var hari = 0; hari <= 7; hari++) {
        expect(_state(ticket: _pro(), afterDays: hari), LicenseState.fresh);
      }
    });

    test('lewat tujuh hari masih terbuka tapi menagih cek ulang', () {
      expect(_state(ticket: _pro(), afterDays: 8), LicenseState.grace);
      expect(_state(ticket: _pro(), afterDays: 14), LicenseState.grace);
    });

    test('lewat empat belas hari tanpa jaringan mengunci', () {
      expect(_state(ticket: _pro(), afterDays: 15), LicenseState.locked);
    });

    test('tiket kedaluwarsa mengunci walau baru saja diverifikasi', () {
      expect(
        _state(ticket: _pro(validAfterDays: 3), afterDays: 4),
        LicenseState.locked,
      );
    });

    test('toleransi dihitung dari cek terakhir, bukan dari masa berlaku', () {
      // Langganan masih satu tahun lagi, tapi hp ini empat belas hari lebih
      // tidak bicara dengan server: fitur ditutup sampai ada sinyal.
      expect(
        _state(ticket: _pro(validAfterDays: 365), afterDays: 15),
        LicenseState.locked,
      );
    });

    test('jam yang dimundurkan tidak menghapus hutang cek ulang', () {
      // Perangkat sudah 10 hari offline, lalu pengguna menggeser jamnya
      // kembali ke hari nol.
      expect(
        _state(ticket: _pro(), afterDays: 0, seenAfterDays: 10),
        LicenseState.grace,
      );
    });

    test('jam yang dimundurkan tidak membuka kunci setelah tenggat', () {
      expect(
        _state(ticket: _pro(), afterDays: 1, seenAfterDays: 15),
        LicenseState.locked,
      );
    });

    test('jam terbaik tidak pernah berada di bawah yang pernah dilihat', () {
      expect(LicenseGate.bestClock(_t0 + 5 * _day, _t0), _t0 + 5 * _day);
      expect(LicenseGate.bestClock(_t0, _t0 + 5 * _day), _t0 + 5 * _day);
    });

    test('verifikasi baru membuka kembali fitur yang tenggang', () {
      final tenggang = _pro(checkedAt: _t0);
      expect(_state(ticket: tenggang, afterDays: 20), LicenseState.locked);
      final segar = _pro(checkedAt: _t0 + 20 * _day);
      expect(_state(ticket: segar, afterDays: 20), LicenseState.fresh);
    });

    test('fitur terbuka selama state bukan locked', () {
      expect(
        LicenseGate.allowsPro(
          ticket: _pro(),
          seenMicros: _t0 + 8 * _day,
          nowMicros: _t0 + 8 * _day,
        ),
        isTrue,
      );
      expect(
        LicenseGate.allowsPro(
          ticket: _pro(),
          seenMicros: _t0,
          nowMicros: _t0 + 15 * _day,
        ),
        isFalse,
      );
    });
  });
}

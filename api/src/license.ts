/**
 * Kode lisensi: bentuknya, dan keputusan apakah sebuah perangkat boleh pro.
 *
 * Sisi perangkat punya aturan yang sama di `app/lib/domain/license.dart`. Yang
 * di sini adalah sisi yang memutuskan, dan bedanya penting: hp hanya menjaga
 * agar layar pro tidak muncul saat tidak ada sinyal, sedangkan Worker ini yang
 * menentukan siapa pemilik baris di Neon.
 *
 * Kode tidak pernah disimpan apa adanya. Yang di basis data adalah hash-nya,
 * jadi salinan tabel `license` yang bocor tidak menyerahkan satu pun kunci —
 * dan penerbitan kode lewat `psql` harus menuliskan hash yang sama (lihat
 * `migrations/0001_init.sql`).
 */

import type { DeviceRecord, Edition, LicenseRecord } from "./store.ts";

export const CODE_PREFIX = "KRSB";
export const GROUPS = 2;
export const GROUP_LENGTH = 4;

/**
 * Alfabet base32 Crockford: 32 lambang tanpa I, L, O, U. Delapan lambang isi
 * = 2^40 kunci, jadi menebak buta bukan ancaman yang layak ditakuti; yang harus
 * dijaga justru salinan kode di catatan seseorang, dan itu urusan hash.
 */
export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const ALPHABET_SET = new Set(ALPHABET.split(""));

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Membentuk balik apa pun yang diketik pengguna — huruf besar-kecil, spasi,
 * titik, garis bawah — menjadi `KRSB-XXXX-XXXX`, atau `null`.
 *
 * `null` berarti permintaannya tidak pernah ada di daftar kode kita, dan
 * jawabannya harus persis sama dengan "kode tidak dikenal". Membedakan keduanya
 * akan menjadi mesin pencari kode.
 */
export function normalizeCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact.startsWith(CODE_PREFIX)) return null;
  const body = compact.slice(CODE_PREFIX.length);
  if (body.length !== GROUPS * GROUP_LENGTH) return null;
  for (const symbol of body) {
    if (!ALPHABET_SET.has(symbol)) return null;
  }
  const groups: string[] = [];
  for (let index = 0; index < GROUPS; index++) {
    groups.push(body.slice(index * GROUP_LENGTH, (index + 1) * GROUP_LENGTH));
  }
  return `${CODE_PREFIX}-${groups.join("-")}`;
}

/** Isi `POST /license/verify` setelah dibersihkan; `null` = bentuknya salah. */
export type VerifyRequest = {
  code: string | null;
  deviceId: string | null;
};

/** Hasil yang boleh diketahui publik. Yang sah dan yang gagal sama kaburnya. */
export type VerifyOutcome =
  | {
      status: "ok";
      owner: string;
      edition: Edition;
      deviceId: string;
      /** null berarti slotnya baru; angka lama berarti perangkat ini kembali. */
      licensedAtMicros: number | null;
    }
  | { status: "invalid" }
  | { status: "revoked" }
  | { status: "device_limit"; maxDevices: number };

/**
 * Memeriksa satu minta aktivasi.
 *
 * `code` dan `deviceId` adalah hasil pembersihan handler: `null` berarti
 * bentuknya bukan milik klien kita, dan jawabannya harus persis sama dengan
 * "kode tidak dikenal". Membedakan keduanya akan menjadi mesin pencari kode.
 *
 * `license` dicari lewat hash kode, jadi fungsi ini tidak pernah menerima kode
 * yang belum dibersihkan.
 */
export function planVerify(input: {
  code: string | null;
  deviceId: string | null;
  license: LicenseRecord | null;
  devices: DeviceRecord[];
}): VerifyOutcome {
  if (input.code === null || input.deviceId === null) return { status: "invalid" };
  const license = input.license;
  if (license === null) return { status: "invalid" };
  if (license.revoked) return { status: "revoked" };
  const already = input.devices.find((device) => device.deviceId === input.deviceId);
  if (already === undefined && input.devices.length >= license.maxDevices) {
    return { status: "device_limit", maxDevices: license.maxDevices };
  }
  return {
    status: "ok",
    owner: license.owner,
    edition: license.edition,
    deviceId: input.deviceId,
    /** null berarti slotnya baru; angka lama berarti perangkat ini kembali. */
    licensedAtMicros: already ? already.licensedAtMicros : null,
  };
}

function normalizeInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : null;
}

/**
 * Bentuk bersih dari sepasang isian minta aktivasi. Dimisahkan dari
 * `planVerify` supaya sisi yang menyentuh basis data tetap tipis.
 */
export function readVerifyRequest(body: unknown): VerifyRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { code: null, deviceId: null };
  }
  const record = body as Record<string, unknown>;
  const typed = normalizeInput(record["code"]);
  const device = normalizeInput(record["device_id"]);
  return {
    code: typed === null ? null : normalizeCode(typed),
    deviceId: isDeviceId(device) ? device : null,
  };
}

/**
 * `device_id` dibuat aplikasi lewat pustaka uuid, jadi bentuk yang lain bukan
 * pengguna yang salah ketik — itu id yang dikarang.
 */
export function isDeviceId(value: string | null): value is string {
  return value !== null && UUID_PATTERN.test(value);
}

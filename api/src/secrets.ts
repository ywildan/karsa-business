/**
 * Kripto milik runtime, bukan milik pustaka.
 *
 * Worker dan Node sama-sama menyediakan `crypto` global, jadi berkas ini jalan
 * di dua tempat tanpa satu pun dependensi — dan karena ia bukan bagian dari
 * `adapter.ts`, ia bisa diuji di laptop ini. Itu bedanya dengan hash yang
 * diimpor dari `node:crypto`: yang satu dipakai tes, yang ini dipakai produksi,
 * dan keduanya harus menghasilkan angka yang sama persis.
 *
 * Yang disimpan basis data hanya dua hal: hash kode lisensi dan hash token
 * perangkat. Keduanya satu arah, jadi kebocoran tabel `license` dan `device`
 * tidak menyerahkan kunci apa pun untuk dipakai.
 */

import type { Secrets } from "./store.ts";

/**
 * Deklarasi lokal, bukan dari `lib.dom`. Alasannya praktis: `@types/node` dan
 * lib DOM sama-sama mengaku memiliki `crypto`, dan adu deklarasi itu membuat
 * berkas sekecil ini gagal di tipe. Yang kita butuhkan cuma dua metoda.
 */
declare const crypto: {
  subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> };
  getRandomValues<T extends Uint8Array>(values: T): T;
};

const encoder = new TextEncoder();

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** Token 16 byte acak, dipakai apa adanya oleh perangkat sebagai Bearer. */
function newToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

export const webSecrets: Secrets = {
  async sha256Hex(input: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
    return hex(new Uint8Array(digest));
  },
  newToken,
};

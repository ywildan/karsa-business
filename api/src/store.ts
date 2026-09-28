/**
 * Batas antara logika dan dunia luar.
 *
 * Worker hanya bicara lewat dua antarmuka ini. `Store` adalah Neon, `Secrets`
 * adalah kripto runtime. Keduanya disuntik, jadi `memory.ts` bisa memasang
 * penggantinya dan seluruh aturan sinkronisasi diuji tanpa satu pun akun cloud —
 * termasuk sebelum `migrations/0001_init.sql` pernah dijalankan.
 */

import type { PlannedWrite, StoredRow } from "./sync.ts";

export type Edition = "free" | "pro";

/** Siapa yang mengetuk, hasil dari satu token yang sah. */
export type Principal = {
  owner: string;
  /** Perangkat pemilik token; `device_id` pada baris diturunkan dari sini. */
  deviceId: string;
  edition: Edition;
};

export type LicenseRecord = {
  codeHash: string;
  owner: string;
  edition: Edition;
  revoked: boolean;
  maxDevices: number;
};

export type DeviceRecord = {
  deviceId: string;
  tokenHash: string;
  licensedAtMicros: number;
};

export type BusinessRow = { id: string; name: string };

export type TrialRow = {
  account_code: string;
  name: string;
  debit: number;
  credit: number;
};

export type BindInput = {
  owner: string;
  deviceId: string;
  codeHash: string;
  tokenHash: string;
  licensedAtMicros: number;
};

export interface Store {
  /** Menarik `count` nomor antrean. Boleh berlubang; tidak pernah menurun. */
  claimRevs(count: number): Promise<number[]>;
  /** Satu transaksi: seluruh baris atau tidak ada sama sekali. */
  applyWrites(writes: readonly PlannedWrite[]): Promise<void>;
  rowsSince(owner: string, sinceRev: number, limit: number): Promise<StoredRow[]>;
  /** rev terkecil yang masih bisa dilayani setelah tombstone dikompaksi. */
  floorRev(owner: string): Promise<number>;
  licenseByCodeHash(codeHash: string): Promise<LicenseRecord | null>;
  devicesOf(owner: string): Promise<DeviceRecord[]>;
  /** Menaruh token baru untuk perangkat ini; token lama perangkat itu mati. */
  bindDevice(input: BindInput): Promise<void>;
  principalByTokenHash(tokenHash: string): Promise<Principal | null>;
  businessesOf(owner: string): Promise<BusinessRow[]>;
  trialBalance(owner: string, businessId: string): Promise<TrialRow[]>;
}

export interface Secrets {
  /** Hash satu arah: yang tersimpan di basis data bukan kunci, bukan kode. */
  sha256Hex(input: string): Promise<string>;
  /** Token acak yang tidak bisa ditebak, dipakai apa adanya oleh perangkat. */
  newToken(): string;
}

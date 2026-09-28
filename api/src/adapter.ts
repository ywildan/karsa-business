/**
 * Neon sebagai `Store`.
 *
 * Berkas ini sengaja TIDAK mengimpor driver apa pun. Yang dibutuhkannya cuma
 * dua fungsi — satu untuk bertanya, satu untuk menulis sekalian — dan keduanya
 * disuntik. Hasilnya: pemetaan baris basis data bisa diuji dengan `node --test`
 * memakai pengganti palsu, sementara satu-satunya baris yang tidak teruji
 * menyempit jadi satu talian di `index.ts` yang memanggil `neon()`.
 *
 * Dua hal yang membuat lapisan ini ada:
 *
 * 1. **Angka besar kembali sebagai teks.** Pengemudi `pg` mengirim `int8` dan
 *    `numeric` sebagai string supaya tidak kehilangan presisi. `rev`,
 *    `floor_rev`, `licensed_at`, `debit`, `credit` dan `max_devices` semuanya
 *    bisa datang sebagai `"42"`, jadi tiap angka dibaca lewat `int()`. Tanpa
 *    itu, `rev > since` di sisi klien membandingkan string dan urutannya jadi
 *    aneh tanpa kesalahan yang berbunyi.
 * 2. **Baris basis data tidak pernah dipercaya bentuknya.** Yang tidak sah
 *    ditolak, bukan diubah-ubah supaya cocok.
 */

import { TABLES, type Table } from "./protocol.ts";
import type { PlannedWrite, StoredRow } from "./sync.ts";
import {
  bindStatement,
  businessesStatement,
  devicesStatement,
  floorReadStatement,
  insertStatement,
  licenseStatement,
  principalStatement,
  pullStatement,
  revsStatement,
  trialBalanceStatement,
  type Statement,
} from "./sql.ts";
import type {
  BusinessRow,
  DeviceRecord,
  Edition,
  Store,
  TrialRow,
} from "./store.ts";

export type Row = Record<string, unknown>;

/** Satu kalimat bercopot, hasil akhirnya baris saja. */
export type Ask = (text: string, args: readonly unknown[]) => Promise<Row[]>;

/** Seluruh kalimat berjalan di dalam satu transaksi basis data. */
export type AskMany = (statements: readonly Statement[]) => Promise<unknown>;

export type NeonPorts = { ask: Ask; askMany: AskMany };

function int(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  throw new TypeError(`angka diharapkan, dapat ${typeof value}`);
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new TypeError(`teks diharapkan, dapat ${typeof value}`);
  return value;
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t";
}

/** Edisi hanya ada dua; selain itu bukan kita yang menebak. */
function edition(value: unknown): Edition {
  if (value === "free" || value === "pro") return value;
  throw new TypeError("edisi lisensi tidak dikenal");
}

/** Muatan jsonb: hanya nilai skalar yang boleh lewat ke perangkat. */
function scalars(value: unknown): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  if (typeof value !== "object" || value === null) return out;
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || typeof entry === "string" || typeof entry === "number") out[key] = entry;
  }
  return out;
}

function knownTable(value: unknown): Table {
  const name = text(value);
  // Nama tabel datang dari `to_jsonb`, bukan dari kiriman perangkat, jadi yang
  // tak dikenal berarti skema dan daftar izin sudah bergeser: lebih baik berbunyi
  // daripada mengirim baris ke tabel yang salah di perangkat.
  if (!(TABLES as readonly string[]).includes(name)) {
    throw new TypeError(`tabel di luar daftar izin: ${name}`);
  }
  return name as Table;
}

function first(rows: Row[]): Row | null {
  return rows[0] ?? null;
}

/**
 * `Store` di atas dua fungsi. `askMany` dipakai sekali saja — untuk tulis — dan
 * itu memang seluruh alasan ia ada: satu batch harus mendarat seluruhnya atau
 * tidak sama sekali.
 */
export function neonStore(ports: NeonPorts): Store {
  const { ask, askMany } = ports;

  return {
    async claimRevs(count) {
      const rows = await ask(...spread(revsStatement(count)));
      return rows.map((row) => int(row["rev"]));
    },

    async applyWrites(writes) {
      if (writes.length === 0) return;
      await askMany(writes.map(insertStatement));
    },

    async rowsSince(owner, sinceRev, limit) {
      const rows = await ask(...spread(pullStatement(owner, sinceRev, limit)));
      return rows.map((row): StoredRow => ({
        table: knownTable(row["tbl"]),
        id: text(row["id"]),
        // Pemilik diambil dari pertanyaan, bukan dari jawaban: kolomnya memang
        // tidak ikut terbawa, dan ini tempat hal itu ditegakkan.
        owner,
        rev: int(row["rev"]),
        values: scalars(row["payload"]),
      }));
    },

    async floorRev(owner) {
      const row = first(await ask(...spread(floorReadStatement(owner))));
      return row === null ? 0 : int(row["floor_rev"]);
    },

    async licenseByCodeHash(codeHash) {
      const row = first(await ask(...spread(licenseStatement(codeHash))));
      if (row === null) return null;
      return {
        codeHash: text(row["code_hash"]),
        owner: text(row["owner_id"]),
        edition: edition(row["edition"]),
        revoked: flag(row["revoked"]),
        maxDevices: int(row["max_devices"]),
      };
    },

    async devicesOf(owner) {
      const rows = await ask(...spread(devicesStatement(owner)));
      return rows.map((row): DeviceRecord => ({
        deviceId: text(row["device_id"]),
        tokenHash: text(row["token_hash"]),
        licensedAtMicros: int(row["licensed_at"]),
      }));
    },

    async bindDevice(input) {
      await ask(...spread(bindStatement(input)));
    },

    async principalByTokenHash(tokenHash) {
      const row = first(await ask(...spread(principalStatement(tokenHash))));
      if (row === null) return null;
      return {
        owner: text(row["owner"]),
        deviceId: text(row["device_id"]),
        edition: edition(row["edition"]),
      };
    },

    async businessesOf(owner) {
      const rows = await ask(...spread(businessesStatement(owner)));
      return rows.map((row): BusinessRow => ({ id: text(row["id"]), name: text(row["name"]) }));
    },

    async trialBalance(owner, businessId) {
      const rows = await ask(...spread(trialBalanceStatement(owner, businessId)));
      return rows.map((row): TrialRow => ({
        account_code: text(row["account_code"]),
        name: row["name"] === null ? "" : text(row["name"]),
        debit: int(row["debit"]),
        credit: int(row["credit"]),
      }));
    },
  };
}

/** `Statement` → argumen fungsi `ask`. */
function spread(statement: Statement): [string, readonly unknown[]] {
  return [statement.text, statement.args];
}

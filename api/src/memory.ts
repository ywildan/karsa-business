/**
 * Basis data mainan untuk uji.
 *
 * Kelas ini bukan hanya alat bantu tes: ia adalah spesifikasi tertulis dari
 * `Store`. Kalau sebuah aturan tidak bisa dinyatakan di sini, aturan itu belum
 * cukup jelas untuk dititipkan ke Neon.
 *
 * Yang ditiru cuma empat hal dari Postgres: kunci composite (pemilik, id),
 * antrean perubahan yang menaik, halaman unduhan yang berurutan pada rev, dan
 * batas perangkat. Yang sengaja tidak ditiru: transaksi. Semua tulis di sini
 * terjadi seketika, jadi uji yang butuh "gagal di tengah jalan" harus memakai
 * pembatas yang disuntik, bukan menunggu rolled back.
 */

import { payloadColumnsOf, type Table } from "./protocol.ts";
import type { PlannedWrite, StoredRow } from "./sync.ts";
import type {
  BindInput,
  BusinessRow,
  DeviceRecord,
  Edition,
  LicenseRecord,
  Principal,
  Store,
  TrialRow,
} from "./store.ts";

/** Seperti `DeviceRecord` plus siapa yang mengikatnya — kolom yang ada di Neon. */
type BoundDevice = DeviceRecord & { owner: string; codeHash: string };

function rowKey(owner: string, table: Table, id: string): string {
  return `${owner}|${table}:${id}`;
}

export type SeedLicense = {
  codeHash: string;
  owner: string;
  edition?: Edition;
  revoked?: boolean;
  maxDevices?: number;
};

export class MemoryStore implements Store {
  readonly rows = new Map<string, StoredRow>();
  readonly licenses = new Map<string, LicenseRecord>();
  readonly devices: BoundDevice[] = [];
  readonly floors = new Map<string, number>();
  /** Rekaman apa yang benar-benar diminta, untuk assertion "query tidak bocor". */
  readonly calls: string[] = [];
  private rev = 0;

  seedLicense(seed: SeedLicense): LicenseRecord {
    const record: LicenseRecord = {
      codeHash: seed.codeHash,
      owner: seed.owner,
      edition: seed.edition ?? "pro",
      revoked: seed.revoked ?? false,
      maxDevices: seed.maxDevices ?? 3,
    };
    this.licenses.set(seed.codeHash, record);
    return record;
  }

  async claimRevs(count: number): Promise<number[]> {
    this.calls.push(`claimRevs:${count}`);
    const revs: number[] = [];
    for (let index = 0; index < count; index++) {
      this.rev += 1;
      revs.push(this.rev);
    }
    return revs;
  }

  async applyWrites(writes: readonly PlannedWrite[]): Promise<void> {
    for (const write of writes) {
      this.calls.push(`write:${write.table}:${write.id}`);
      const values: Record<string, string | number | null> = {};
      for (const column of payloadColumnsOf(write.table)) {
        values[column] = write.values[column] ?? null;
      }
      this.rows.set(rowKey(write.owner, write.table, write.id), {
        table: write.table,
        id: write.id,
        owner: write.owner,
        rev: write.rev,
        values,
      });
    }
  }

  async rowsSince(owner: string, sinceRev: number, limit: number): Promise<StoredRow[]> {
    this.calls.push(`rowsSince:${owner}:${sinceRev}:${limit}`);
    return [...this.rows.values()]
      .filter((row) => row.owner === owner && row.rev > sinceRev)
      .sort((a, b) => a.rev - b.rev)
      .slice(0, Math.max(0, limit));
  }

  async floorRev(owner: string): Promise<number> {
    return this.floors.get(owner) ?? 0;
  }

  setFloor(owner: string, floorRev: number): void {
    this.floors.set(owner, Math.max(this.floors.get(owner) ?? 0, floorRev));
  }

  async licenseByCodeHash(codeHash: string): Promise<LicenseRecord | null> {
    this.calls.push(`licenseByCodeHash:${codeHash}`);
    return this.licenses.get(codeHash) ?? null;
  }

  async devicesOf(owner: string): Promise<DeviceRecord[]> {
    return this.devices.filter((device) => device.owner === owner);
  }

  async bindDevice(input: BindInput): Promise<void> {
    const existing = this.devices.find(
      (device) => device.owner === input.owner && device.deviceId === input.deviceId,
    );
    if (existing === undefined) {
      this.devices.push({ ...input });
    } else {
      // Slot yang sama, token yang baru: pemasangan ulang memutus jalur lama.
      existing.tokenHash = input.tokenHash;
      existing.codeHash = input.codeHash;
      existing.licensedAtMicros = input.licensedAtMicros;
    }
  }

  async principalByTokenHash(tokenHash: string): Promise<Principal | null> {
    const device = this.devices.find((candidate) => candidate.tokenHash === tokenHash);
    if (device === undefined) return null;
    const license = this.licenses.get(device.codeHash);
    if (license === undefined || license.revoked || license.owner !== device.owner) {
      return null;
    }
    return {
      owner: device.owner,
      deviceId: device.deviceId,
      edition: license.edition,
    };
  }

  revoke(owner: string): void {
    for (const license of this.licenses.values()) {
      if (license.owner === owner) license.revoked = true;
    }
  }

  async businessesOf(owner: string): Promise<BusinessRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.owner === owner && row.table === "business" && row.values["deleted"] === 0)
      .map((row) => ({ id: row.id, name: String(row.values["name"] ?? "") }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async trialBalance(owner: string, businessId: string): Promise<TrialRow[]> {
    const names = new Map<string, string>();
    for (const row of this.rows.values()) {
      if (row.table !== "account" || row.owner !== owner) continue;
      if (row.values["business_id"] !== businessId) continue;
      names.set(String(row.values["code"]), String(row.values["name"] ?? ""));
    }
    const totals = new Map<string, { debit: number; credit: number }>();
    for (const row of this.rows.values()) {
      if (row.table !== "ledger_line" || row.owner !== owner) continue;
      if (row.values["business_id"] !== businessId) continue;
      if (row.values["deleted"] === 1) continue;
      const code = String(row.values["account_code"]);
      const total = totals.get(code) ?? { debit: 0, credit: 0 };
      total.debit += Number(row.values["debit"] ?? 0);
      total.credit += Number(row.values["credit"] ?? 0);
      totals.set(code, total);
    }
    return [...totals.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, total]) => ({
        account_code: code,
        name: names.get(code) ?? "",
        debit: total.debit,
        credit: total.credit,
      }));
  }

  /** Semua baris milik satu pemilik, untuk assertion konvergensi. */
  snapshotOf(owner: string): StoredRow[] {
    return [...this.rows.values()]
      .filter((row) => row.owner === owner)
      .sort((a, b) => a.rev - b.rev);
  }
}

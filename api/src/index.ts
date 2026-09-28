/**
 * Pemasangan Worker.
 *
 * Isi berkas ini hanya tiga hal yang tidak bisa hidup di tempat lain: membuat
 * kunci koneksi Neon, membaca alamat pengunjung dari `request.cf`, dan
 * menjalankan perapian tombstone lewat cron. Semuanya talian pendek. Setiap
 * keputusan — siapa yang boleh menulis, apa yang boleh keluar, halaman mana yang
 * masih sah — tinggal di `http.ts`, `sync.ts`, `license.ts` dan `sql.ts`, dan
 * itu sebabnya keputusan-keputusan itu bisa diuji tanpa akun cloud: satu-satunya
 * baris di seluruh proyek yang tidak teruji adalah yang memanggil `neon()`.
 */

import { neon } from "@neondatabase/serverless";

import { neonStore, type Ask, type AskMany, type Row } from "./adapter.ts";
import { handle, type Deps } from "./http.ts";
import { MICROS_PER_DAY, TOMBSTONE_RETENTION_DAYS } from "./protocol.ts";
import { compactionPlan } from "./sql.ts";
import { webSecrets } from "./secrets.ts";
import type { Counters } from "./ratelimit.ts";
import type { Store } from "./store.ts";

/** Variabel lingkungan Worker. `DATABASE_URL` adalah secret, bukan `[vars]`. */
type Vars = {
  DATABASE_URL: string;
  /** Daftar asal peramban yang boleh memanggil, dipisah koma. */
  ALLOWED_ORIGINS?: string;
};

type Wiring = { store: Store; ask: Ask; askMany: AskMany };

let wiring: Wiring | null = null;

function wire(vars: Vars): Wiring {
  if (wiring !== null) return wiring;
  const sql = neon(vars.DATABASE_URL);
  const ask: Ask = async (text, args) =>
    (await sql.query(text, [...args])) as Row[];
  const askMany: AskMany = (statements) =>
    sql.transaction((tx) => statements.map((statement) => tx.query(statement.text, [...statement.args])));
  wiring = { store: neonStore({ ask, askMany }), ask, askMany };
  return wiring;
}

/**
 * Hitungan laju hidup sepanjang umur isolat. Dua isolat menghitung terpisah,
 * jadi ini pengereman, bukan pagar — lihat `ratelimit.ts`.
 */
const counters: Counters = new Map();

/**
 * Alamat pengunjung. `request.cf` ada di Worker dan tidak ada di tempat lain,
 * jadi kalau hilang semua pengunjung masuk ke satu ember yang sama: lebih
 * mudah menahan-tekan mesin pencari kode daripada membebaskannya diam-diam.
 */
function clientIp(request: Request): string {
  const cf = (request as Request & { cf?: { clientIp?: string } }).cf;
  return cf?.clientIp ?? "alamat-tak-diketahui";
}

function depsFor(vars: Vars, request: Request): Deps {
  const { store } = wire(vars);
  return {
    store,
    secrets: webSecrets,
    env: { allowedOrigins: vars.ALLOWED_ORIGINS ?? "" },
    counters,
    nowMicros: () => Date.now() * 1000,
    nowSeconds: () => Math.floor(Date.now() / 1000),
    clientIp: () => clientIp(request),
  };
}

export default {
  async fetch(request: Request, vars: Vars): Promise<Response> {
    return handle(request, depsFor(vars, request));
  },

  /**
   * Sehari sekali: catat rev tombstone tertinggi yang akan dibuang, naikkan
   * floor ke sana, baru hapus — semuanya dalam satu transaksi basis data
   * (`compactionPlan`), karena penghapusan tanpa pencatatan adalah cara sejarah
   * berbohong.
   *
   * `DATABASE_URL` sengaja dibaca lewat `wire()` yang sama dengan jalur minta:
   * kalau secret-nya belum dipasang, cron ikut berbunyi dan bukan diam-diam
   * berdalih sudah merapikan apa pun.
   */
  async scheduled(_event: unknown, vars: Vars): Promise<void> {
    const cutoff = Date.now() * 1000 - TOMBSTONE_RETENTION_DAYS * MICROS_PER_DAY;
    await wire(vars).askMany(compactionPlan(cutoff));
  },
};

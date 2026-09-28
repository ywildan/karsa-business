/**
 * Isi kepala Worker: apa yang boleh masuk basis data dan apa yang boleh keluar.
 *
 * Semua fungsi di berkas ini murni — tidak ada `fetch`, tidak ada SQL, tidak ada
 * jam dinding yang dibaca sendiri. Jam, nomor antrean, dan isian basis data
 * semuanya masuk sebagai argumen, jadi aturan yang menentukan apakah catatan
 * pengguna selamat dari jaringan yang putus bisa dijalankan di laptop pengembang
 * dalam waktu satu milidetik per uji.
 *
 * Tiga keputusan yang bentuknya ditentukan di sini:
 *
 * 1. `owner_id` dan `rev` tidak pernah dibaca dari badan minta. Pemilik baris
 *    berasal dari token, nomor antrean berasal dari server.
 * 2. Badu minta yang cacat ditolak seluruhnya, bukan sebagian. Menerima separuh
 *    batch berarti mengirim induk jurnal tanpa anak-anaknya — persis korupsi
 *    yang tidak bisa dilihat pengguna.
 * 3. Unduhan tidak pernah berbohong tentang sejarahnya. Kalau permintaan datang
 *    dari bawah titik kompaksi tombstone, jawabannya 409, bukan halaman yang
 *    tampak normal tapi kehilangan penghapusan.
 */

import {
  MAX_PUSH_ROWS,
  MAX_TEXT_LENGTH,
  PULL_PAGE,
  SERVER_OWNED,
  TABLES,
  payloadColumnsOf,
  wireType,
  type Table,
} from "./protocol.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const ACCOUNT_CODE_PATTERN = /^[0-9]{4}(?:\.[0-9]{1,4})?$/;

/** Kesalahan protokol. `status` adalah kode HTTP yang harus dikembalikan. */
export class ProtocolError extends Error {
  declare readonly code: string;
  declare readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.status = status;
  }
}

/** Satu baris persis seperti yang dikirim perangkat. */
export type IncomingRow = {
  table: string;
  id: string;
  values: Record<string, unknown>;
};

/** Baris yang sudah lolos pemeriksaan bentuk; kolom asing sudah hilang. */
export type CleanRow = {
  table: Table;
  id: string;
  values: Record<string, string | number | null>;
};

/** Baris siap tulis: punya pemilik, nomor antrean, dan cap jam server. */
export type PlannedWrite = {
  table: Table;
  id: string;
  owner: string;
  rev: number;
  values: Record<string, string | number | null>;
};

/** Baris seperti yang tersimpan di Neon. */
export type StoredRow = {
  table: Table;
  id: string;
  owner: string;
  rev: number;
  values: Record<string, string | number | null>;
};

/** Halaman unduhan, siap dijadikan JSON. */
export type PullPage = {
  rows: { table: Table; id: string; rev: number; values: Record<string, string | number | null> }[];
  next_rev: number;
  has_more: boolean;
};

function bad(code: string, message: string, status = 400): never {
  throw new ProtocolError(code, message, status);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Membaca badan `POST /sync/push`. Bentuknya `{ rows: [...] }`; apa pun yang
 * lain berarti pengirimnya bukan klien kita.
 */
export function parsePushBody(body: unknown): CleanRow[] {
  if (!isPlainObject(body)) bad("body_shape", "badan minta bukan objek JSON");
  const rows = body["rows"];
  if (!Array.isArray(rows)) bad("body_shape", "rows bukan daftar");
  if (rows.length > MAX_PUSH_ROWS) {
    bad("too_many_rows", `satu batch maksimal ${MAX_PUSH_ROWS} baris`);
  }
  return rows.map((row, index) => parseRow(row, index));
}

function parseRow(raw: unknown, index: number): CleanRow {
  const at = `baris ${index}`;
  if (!isPlainObject(raw)) bad("row_shape", `${at} bukan objek`);
  const table = raw["table"];
  const id = raw["id"];
  const values = raw["values"];
  if (typeof table !== "string" || !TABLES.includes(table as Table)) {
    bad("unknown_table", `${at}: tabel ${String(table)} tidak ikut sinkron`);
  }
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    bad("bad_id", `${at}: id harus uuid huruf kecil`);
  }
  if (!isPlainObject(values)) bad("row_shape", `${at}: values bukan objek`);
  if (values["id"] !== undefined && values["id"] !== id) {
    bad("id_mismatch", `${at}: id dan values.id berbeda`);
  }
  return { table: table as Table, id, values: cleanValues(table as Table, values, at) };
}

/**
 * Menyaring dan memeriksa isi satu baris. Yang tidak dikenal dibuang dengan
 * suara keras, bukan disimpan diam-diam: kolom asing di jalur tulis berarti
 * seseorang sedang mencoba menulis `rev` atau `owner_id` miliknya sendiri.
 */
function cleanValues(
  table: Table,
  values: Record<string, unknown>,
  at: string,
): Record<string, string | number | null> {
  const allowed = new Set(payloadColumnsOf(table));
  const clean: Record<string, string | number | null> = {};
  for (const [column, value] of Object.entries(values)) {
    if (SERVER_OWNED.includes(column)) {
      bad("server_column", `${at}: kolom ${column} milik server`);
    }
    if (column === "dirty") {
      bad("local_column", `${at}: dirty adalah urusan perangkat`);
    }
    if (!allowed.has(column)) {
      bad("unknown_column", `${at}: kolom ${column} bukan bagian dari ${table}`);
    }
    const type = wireType(table, column);
    if (type === null) bad("unknown_column", `${at}: kolom ${column} tak dikenal`);
    checkValue(table, column, type, value, at);
    clean[column] = value as string | number | null;
  }
  for (const column of allowed) {
    if (!typeIsNullable(wireType(table, column)) && clean[column] === undefined) {
      bad("missing_column", `${at}: kolom ${column} wajib ada`);
    }
  }
  checkInvariants(table, clean, at);
  return clean;
}

function typeIsNullable(type: string | null): boolean {
  return type === null || type.endsWith("?");
}

function checkValue(
  table: Table,
  column: string,
  type: string,
  value: unknown,
  at: string,
): void {
  const where = `${at}.${column}`;
  if (value === null) {
    if (!type.endsWith("?")) bad("null_required", `${where} tidak boleh null`);
    return;
  }
  switch (type.replace("?", "")) {
    case "int":
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        bad("bad_int", `${where} harus bilangan bulat`);
      }
      return;
    case "text":
      if (typeof value !== "string") bad("bad_text", `${where} harus teks`);
      if (value.length > MAX_TEXT_LENGTH) {
        bad("too_long", `${where} lebih panjang ${MAX_TEXT_LENGTH} karakter`);
      }
      return;
    case "uuid":
      if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        bad("bad_uuid", `${where} harus uuid huruf kecil`);
      }
      return;
    default:
      bad("bad_type", `${where}: jenis kolom ${type} tidak dikenal`);
  }
}

/**
 * Invarian yang juga ada di CHECK SQLite. Server tetap memeriksanya karena
 * perangkat pengguna bukan pihak yang dipercaya: yang bocor ke publik adalah
 * kunci API, dan siapa pun yang pegang kunci itu bisa mengarang jurnal palsu
 * kalau sisinya sendiri tidak dijaga.
 */
function checkInvariants(
  table: Table,
  values: Record<string, string | number | null>,
  at: string,
): void {
  const flag = (column: string) => {
    const value = values[column];
    if (value !== 0 && value !== 1) {
      bad("bad_flag", `${at}.${column} harus 0 atau 1`);
    }
  };
  const code = (column: string) => {
    const value = values[column];
    if (typeof value !== "string" || !ACCOUNT_CODE_PATTERN.test(value)) {
      bad("bad_account_code", `${at}.${column} harus kode akun, misal 6200.01`);
    }
  };

  flag("deleted");
  switch (table) {
    case "account":
      code("code");
      break;
    case "ledger_entry":
      code("cash_account_code");
      break;
    case "ledger_line": {
      code("account_code");
      const debit = Number(values["debit"] ?? 0);
      const credit = Number(values["credit"] ?? 0);
      if (debit < 0 || credit < 0) bad("negative_amount", `${at}: nominal negatif`);
      if ((debit > 0) === (credit > 0)) {
        bad("unbalanced_line", `${at}: satu baris jurnal debit ATAU kredit`);
      }
      break;
    }
    case "item":
      flag("tracks_stock");
      break;
    case "stock_movement": {
      const direction = values["direction"];
      if (direction !== 1 && direction !== -1) {
        bad("bad_direction", `${at}.direction harus 1 atau -1`);
      }
      if (Number(values["quantity"] ?? 0) <= 0) {
        bad("bad_quantity", `${at}.quantity harus lebih dari nol`);
      }
      break;
    }
    default:
      break;
  }
}

/** Yang dibutuhkan `planPush` dari dunia luar. */
export type PushContext = {
  owner: string;
  /** Perangkat pemilik token — bukan apa yang diklaim badan minta. */
  device_id: string;
  /** Nomor antrean yang sudah ditarik server, sepanjang jumlah baris. */
  revs: readonly number[];
  now_micros: number;
};

/**
 * Menuliskan rencana tulis. `rev` naik searah urutan tiba, dan urutan tiba
 * adalah urutan menang: dua hp yang offline berbulan-bulan boleh mengirim
 * apa pun, kapan pun, hasilnya tetap sama bagi keduanya.
 */
export function planPush(
  rows: readonly CleanRow[],
  context: PushContext,
): PlannedWrite[] {
  if (context.revs.length !== rows.length) {
    bad("rev_shortage", "nomor antrean tidak sebanyak barisnya", 500);
  }
  let previous = 0;
  return rows.map((row, index) => {
    const rev = context.revs[index] as number;
    if (rev <= previous) bad("rev_unordered", "nomor antrean tidak menaik", 500);
    previous = rev;
    const values: Record<string, string | number | null> = { ...row.values };
    values["id"] = row.id;
    // Dua kolom ini bukan laporan klien: keduanya adalah fakta server pada
    // saat baris ini tiba. Nilai yang dikirim dibuang tanpa dibantah.
    values["device_id"] = context.device_id;
    values["updated_at"] = context.now_micros;
    if (values["created_at"] === undefined) {
      values["created_at"] = context.now_micros;
    }
    return { table: row.table, id: row.id, owner: context.owner, rev, values };
  });
}

/** Yang dibutuhkan `planPull` dari dunia luar. */
export type PullContext = {
  owner: string;
  since_rev: number;
  limit: number;
  /** rev terkecil yang masih bisa dilayani; di bawahnya sejarah sudah ringkas. */
  floor_rev: number;
};

/**
 * Menyusun halaman unduhan dari baris yang sudah diurutkan server.
 *
 * Pemeriksaan di sini sengaja berlebihan. Fungsinya bukan mengulang kerja
 * query, tapi memastikan jalur tulis yang salah di sisi basis data tidak bisa
 * berakhir menyetor baris milik orang lain ke hp pengguna.
 */
export function planPull(rows: readonly StoredRow[], context: PullContext): PullPage {
  const limit = Math.min(
    Math.max(1, Math.trunc(context.limit || PULL_PAGE)),
    PULL_PAGE,
  );
  // Sejarah penuh SELALU bisa dilayani, dan ia adalah obat dari keadaan di
  // bawah ini. Jadi 409 hanya untuk perangkat yang mengaku sudah punya kursor
  // sementara kami sudah tidak bisa melanjutkan dari sana; menolak permintaan
  // dengan `since_rev` 0 berarti menyuruh klien melakukan unduh ulang dengan
  // cara yang akan ditolak oleh dirinya sendiri.
  if (context.since_rev > 0 && context.since_rev < context.floor_rev) {
    throw new ProtocolError(
      "resync_required",
      `sejarah dari rev ${context.since_rev} sudah diringkas; unduh ulang penuh`,
      409,
    );
  }
  const above = [...rows]
    .filter((row) => row.rev > context.since_rev)
    .sort((a, b) => a.rev - b.rev);
  const page: StoredRow[] = [];
  for (const row of above) {
    if (row.owner !== context.owner) {
      bad("foreign_row", `baris ${row.table}:${row.id} bukan milik pemilik ini`, 500);
    }
    if (page.length >= limit) break;
    page.push(row);
  }
  let next_rev = context.since_rev;
  const body = page.map((row) => {
    if (row.rev <= next_rev) {
      // Tidak mungkin dua baris berbagi rev yang sama, dan tidak ada yang boleh
      // lebih kecil: kursor klien hanya boleh maju.
      bad("rev_regressed", "halaman unduhan mundur", 500);
    }
    next_rev = row.rev;
    return {
      table: row.table,
      id: row.id,
      rev: row.rev,
      values: publicValues(row.table, row.values),
    };
  });
  return { rows: body, next_rev, has_more: above.length > page.length };
}

/** Hanya kolom yang memang bagian dari tabel itu keluar; sisanya dianggap bocor. */
function publicValues(
  table: Table,
  values: Record<string, string | number | null>,
): Record<string, string | number | null> {
  const allowed = new Set(payloadColumnsOf(table));
  const out: Record<string, string | number | null> = {};
  for (const [column, value] of Object.entries(values)) {
    if (allowed.has(column)) out[column] = value;
  }
  return out;
}

/** Batas halaman unduhan, dipakai handler sebelum menyentuh basis data. */
export function pullLimit(raw: string | null): number {
  if (raw === null || raw === "") return PULL_PAGE;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    bad("bad_limit", "since_rev dan limit harus bilangan bulat positif");
  }
  return Math.min(parsed, PULL_PAGE);
}

/** rev awal unduhan; tidak ada `since_rev` berarti sejarah penuh. */
export function pullSince(raw: string | null): number {
  if (raw === null || raw === "") return 0;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    bad("bad_since", "since_rev harus bilangan bulat tidak negatif");
  }
  return parsed;
}

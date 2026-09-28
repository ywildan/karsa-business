/**
 * Kosakata yang sama, dipakai dua bahasa.
 *
 * Sisi perangkat ditulis di `app/lib/domain/sync_protocol.dart`, sisi server di
 * berkas ini. `protocol_test.ts` membaca berkas Dart itu dan membandangkannya
 * kolom per kolom, jadi daftar yang bergeser di salah satu sisi gagal di loop
 * murah — sebelum ada satu pun baris yang tertukar lewat jaringan.
 *
 * Hanya sintaks TypeScript yang bisa dihapus yang dipakai di direktori ini:
 * tanpa `enum`, tanpa `namespace`, tanpa property konstruktor. Node >= 23.6
 * menjalankannya apa adanya dan Cloudflare men-transpilnya dengan esbuild,
 * sehingga satu sumber yang sama terbaca di kedua sisi tanpa satu pun
 * dependensi yang dipasang.
 */

/** Jenis nilai satu kolom kiriman. `?` berarti kolomnya boleh null di SQLite. */
export type WireType = "text" | "text?" | "int" | "int?" | "uuid" | "uuid?";

/**
 * Kolom yang boleh meninggalkan perangkat, persis seperti `SyncProtocol.wireColumns`.
 * Urutan urutan kunci dipakai uji drift; urutan nilainya tidak.
 */
export const WIRE_COLUMNS = {
  business: ["id", "name"],
  party: ["id", "business_id", "name", "phone", "note"],
  item: [
    "id",
    "business_id",
    "name",
    "unit",
    "sale_price",
    "buy_price",
    "tracks_stock",
  ],
  account: ["id", "business_id", "code", "name"],
  ledger_entry: [
    "id",
    "business_id",
    "entered_on",
    "posted_at",
    "kind",
    "description",
    "party_id",
    "item_id",
    "quantity",
    "unit_price",
    "cash_account_code",
  ],
  ledger_line: [
    "id",
    "entry_id",
    "business_id",
    "account_code",
    "debit",
    "credit",
  ],
  stock_movement: [
    "id",
    "business_id",
    "item_id",
    "entered_on",
    "direction",
    "quantity",
    "unit_cost",
    "entry_id",
  ],
} as const satisfies Record<string, readonly string[]>;

export type Table = keyof typeof WIRE_COLUMNS;

export const TABLES = Object.keys(WIRE_COLUMNS) as Table[];

/** Tabel milik perangkat saja. `meta` tidak pernah meninggalkan hp. */
export const LOCAL_ONLY_TABLES = ["meta"];

/**
 * Kolom yang dibawa perangkat supaya server tahu kapan barisnya dibuat dan siapa
 * pengubah terakhirnya. `updated_at` diterima tapi tidak dipercaya: server
 * men-stempel ulang saat baris tiba.
 */
export const STAMPED_COLUMNS = ["created_at", "updated_at", "deleted", "device_id"];

/** Kolom milik server. Muncul salah satunya di badan minta = minta ditolak. */
export const SERVER_OWNED = ["owner_id", "rev"];

/** Jenis tiap kolom kiriman, mengikuti DDL SQLite di `app/lib/data/db.dart`. */
export const WIRE_TYPES: Record<Table, Record<string, WireType>> = {
  business: { id: "uuid", name: "text" },
  party: {
    id: "uuid",
    business_id: "uuid",
    name: "text",
    phone: "text?",
    note: "text?",
  },
  item: {
    id: "uuid",
    business_id: "uuid",
    name: "text",
    unit: "text",
    sale_price: "int",
    buy_price: "int",
    tracks_stock: "int",
  },
  account: { id: "uuid", business_id: "uuid", code: "text", name: "text" },
  ledger_entry: {
    id: "uuid",
    business_id: "uuid",
    entered_on: "int",
    posted_at: "int",
    kind: "text",
    description: "text",
    party_id: "uuid?",
    item_id: "uuid?",
    quantity: "int?",
    unit_price: "int?",
    cash_account_code: "text",
  },
  ledger_line: {
    id: "uuid",
    entry_id: "uuid",
    business_id: "uuid",
    account_code: "text",
    debit: "int",
    credit: "int",
  },
  stock_movement: {
    id: "uuid",
    business_id: "uuid",
    item_id: "uuid",
    entered_on: "int",
    direction: "int",
    quantity: "int",
    unit_cost: "int",
    entry_id: "uuid?",
  },
};

/** Jenis kolom yang di-stempel; sama untuk semua tabel kiriman. */
export const STAMPED_TYPES: Record<string, WireType> = {
  created_at: "int",
  updated_at: "int",
  deleted: "int",
  device_id: "uuid",
};

/** Baris per kiriman — angka yang sama dengan sisi perangkat. */
export const PUSH_BATCH = 200;

/** Halaman per unduhan. */
export const PULL_PAGE = 500;

/**
 * Batas keras badan minta. Dua kali lipat apa yang sanggup dihasilkan klien
 * kita sendiri (lihat `SyncProtocol.pushBatch`); di atas itu yang mengetuk
 * bukan aplikasi, tapi skrip.
 */
export const MAX_PUSH_ROWS = 500;

/** Panjang teks terpanjang yang masih masuk akal sebagai ketikan pengguna. */
export const MAX_TEXT_LENGTH = 2000;

/** Hari sebelum tombstone boleh dikompaksi. Lihat `floor` di `sync.ts`. */
export const TOMBSTONE_RETENTION_DAYS = 30;

/** Mikrodetik per hari, supaya tidak ada konstanta yang muncul dua wujud. */
export const MICROS_PER_DAY = 24 * 60 * 60 * 1_000_000;

/** Nama kolom yang boleh dibaca klien dari satu baris server. */
export function wireColumnsOf(table: Table): readonly string[] {
  return WIRE_COLUMNS[table];
}

/** Kolom kiriman + kolom yang di-stempel, tanpa `id` yang dua kali disebut. */
export function payloadColumnsOf(table: Table): string[] {
  const seen = new Set<string>();
  for (const column of [...WIRE_COLUMNS[table], ...STAMPED_COLUMNS]) {
    seen.add(column);
  }
  return [...seen];
}

/** Jenis untuk satu nama kolom, atau `null` kalau kolomnya memang asing. */
export function wireType(table: Table, column: string): WireType | null {
  return WIRE_TYPES[table][column] ?? STAMPED_TYPES[column] ?? null;
}

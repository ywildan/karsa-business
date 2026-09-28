/**
 * Menyusun kalimat SQL, tanpa pernah menyentuh basis data.
 *
 * Worker bicara ke Neon lewat `postgres.js`, yang menahan kita pada permintaan
 * bercopot — dan berkas ini yang memastikan hanya nama tabel dan nama kolom
 * dari daftar izin yang pernah masuk ke teks SQL. Nilai dari perangkat tidak
 * pernah dirakit ke dalam teks: ia selalu jadi `$n`. Itu bedanya antara
 * injeksi SQL dan permintaan yang panjang.
 *
 * Aturan yang harus tetap benar kalau seseorang menambahkan kolom: nama yang tidak
 * ada di `protocol.ts` melempar, bukan disaring diam-diam.
 */

import {
  SERVER_OWNED,
  STAMPED_COLUMNS,
  TABLES,
  WIRE_COLUMNS,
  type Table,
} from "./protocol.ts";
import type { PlannedWrite } from "./sync.ts";

export type Statement = { text: string; args: unknown[] };

/**
 * Jam basis data, dalam mikrodetik sejak epoch.
 *
 * Dipakai untuk kolom catatanan saja (`updated_at`), bukan untuk fakta yang
 * dibandingkan klien. Satu jam untuk seluruh penyewa lebih jujur daripada jam
 * tiap isolat Worker, dan ia membuat `Store` tidak perlu disuntiki clock hanya
 * untuk menstempel baris yang tidak dibaca siapa-siapa.
 */
const NOW_MICROS = "(extract(epoch from now()) * 1000000)::bigint";

/** Nama yang boleh muncul sebagai pengenal. Selain ini: lempar. */
const ALLOWED_IDENTIFIERS = new Set<string>([
  ...TABLES,
  ...Object.values(WIRE_COLUMNS).flat(),
  ...STAMPED_COLUMNS,
  ...SERVER_OWNED,
  // Nama yang dipakai di teks SQL tapi bukan milik baris kiriman.
  "device",
  "license",
  "sync_floor",
]);

export function identifier(name: string): string {
  if (!ALLOWED_IDENTIFIERS.has(name)) {
    throw new Error(`pengenal di luar daftar izin: ${name}`);
  }
  return name;
}

/** Kolom tulis, berurutan tetap: kunci server, lalu isi kiriman. */
function writeColumns(table: Table): string[] {
  const columns = ["owner_id", "id", "rev"] as string[];
  for (const column of [...STAMPED_COLUMNS]) {
    if (column !== "id") columns.push(column);
  }
  for (const column of WIRE_COLUMNS[table]) {
    if (column !== "id") columns.push(column);
  }
  return columns.map(identifier);
}

/**
 * Satu tulis idempoten. `ON CONFLICT (owner_id, id)` adalah tempat kunci
 * composite itu bekerja: dua pemilik yang kebetulan memakai id yang sama tidak
 * saling menimpa, karena yang bertabrak adalah pasangan (pemilik, id) — bukan
 * id-nya saja.
 */
export function insertStatement(write: PlannedWrite): Statement {
  const table = identifier(write.table);
  const columns = writeColumns(write.table);
  const args: unknown[] = [write.owner, write.id, write.rev];
  for (const column of columns.slice(3)) {
    args.push(write.values[column] ?? null);
  }
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const updates = columns
    .filter((column) => !["owner_id", "id", "created_at"].includes(column))
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(", ");
  return {
    text: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ` +
      `ON CONFLICT (owner_id, id) DO UPDATE SET ${updates}`,
    args,
  };
}

/**
 * Halaman unduhan: satu permintaan untuk semua tabel, diurutkan pada antrean
 * perubahan yang sama yang dipakai perangkat menentukan urut tiba.
 *
 * `to_jsonb(t) - 'owner_id'` membuat bentuk baris yang keluar mengikuti skema,
 * bukan mengikuti daftar yang bisa tertinggal. Kolom server dibuang di sini
 * supaya `rev` tidak pernah dua kali masuk muatan.
 *
 * Label hasil dinamai `tbl` dan `payload`, bukan `table` dan `values`. Dua kata
 * terakhir kata kunci cadangan: boleh muncul setelah `AS`, tapi tidak boleh
 * dipakai sebagai acuan polos — dan kalimat luarnya justru membaca acuan itu
 * (`SELECT tbl, ... FROM (...) delta`), sehingga versi `table`/`values` gagal
 * saat dijalankan di Neon, bukan saat ditulis. Penerjemah hasilnya yang
 * mengembalikan bentuk muatan, supaya nama yang lewat jaringan tetap nama yang
 * dipakai klien.
 */
export function pullStatement(
  owner: string,
  sinceRev: number,
  limit: number,
): Statement {
  const branches = TABLES.map((table) => {
    const name = identifier(table);
    return `SELECT '${name}' AS tbl, id, rev, to_jsonb(t) - 'owner_id' - 'rev' AS payload FROM ${name} t WHERE t.owner_id = $1 AND t.rev > $2`;
  });
  return {
    text:
      `SELECT tbl, id, rev, payload FROM (${branches.join(" UNION ALL ")}) ` +
      `delta ORDER BY rev ASC LIMIT $3`,
    args: [owner, sinceRev, limit],
  };
}

/** Pemilik token: liceninya masih aktif dan perangkatnya masih terikat. */
export function principalStatement(tokenHash: string): Statement {
  return {
    text:
      "SELECT d.owner_id AS owner, d.device_id, l.edition FROM device d " +
      "JOIN license l ON l.owner_id = d.owner_id AND l.code_hash = d.code_hash " +
      "WHERE d.token_hash = $1 AND l.revoked_at IS NULL",
    args: [tokenHash],
  };
}

/** Satu kode, dibaca lewat hash-nya. */
export function licenseStatement(codeHash: string): Statement {
  return {
    text:
      "SELECT code_hash, owner_id, edition, (revoked_at IS NOT NULL) AS revoked, " +
      "max_devices FROM license WHERE code_hash = $1",
    args: [codeHash],
  };
}

export function devicesStatement(owner: string): Statement {
  return {
    text: "SELECT device_id, token_hash, licensed_at FROM device WHERE owner_id = $1",
    args: [owner],
  };
}

/**
 * Mengikat satu perangkat. Token lama perangkat itu digantikan: yang tersimpan
 * hanya hash, jadi pemasangan ulang benar-benar memutus jalur perangkat lama.
 * `licensed_at` tetap milik pemanggil (ia fakta lisensi), `updated_at` milik jam
 * basis data (ia catatan belaka).
 */
export function bindStatement(input: {
  owner: string;
  deviceId: string;
  codeHash: string;
  tokenHash: string;
  licensedAtMicros: number;
}): Statement {
  return {
    text:
      "INSERT INTO device (owner_id, device_id, code_hash, token_hash, licensed_at, updated_at) " +
      "VALUES ($1, $2, $3, $4, $5, " + NOW_MICROS + ") " +
      "ON CONFLICT (owner_id, device_id) DO UPDATE SET " +
      "code_hash = EXCLUDED.code_hash, token_hash = EXCLUDED.token_hash, " +
      "updated_at = " + NOW_MICROS,
    args: [input.owner, input.deviceId, input.codeHash, input.tokenHash, input.licensedAtMicros],
  };
}

/** Neraca saldo satu usaha — fondasi laporan yang sama dipakai dashboard. */
export function trialBalanceStatement(
  owner: string,
  businessId: string,
): Statement {
  return {
    text:
      "SELECT l.account_code AS account_code, a.name AS name, " +
      "COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit " +
      "FROM ledger_line l " +
      "JOIN ledger_entry e ON e.owner_id = l.owner_id AND e.id = l.entry_id " +
      "LEFT JOIN account a ON a.owner_id = l.owner_id AND a.business_id = l.business_id " +
      "AND a.code = l.account_code AND a.deleted = 0 " +
      "WHERE l.owner_id = $1 AND l.business_id = $2 AND l.deleted = 0 AND e.deleted = 0 " +
      "GROUP BY l.account_code, a.name ORDER BY l.account_code ASC",
    args: [owner, businessId],
  };
}

export function businessesStatement(owner: string): Statement {
  return {
    text: "SELECT id, name FROM business WHERE owner_id = $1 AND deleted = 0 ORDER BY name",
    args: [owner],
  };
}

/**
 * Baris terhapus yang lebih tua dari batas. Predikatnya SATU konstanta: kalau
 * penghapusan dan kenaikan `floor` sampai memakai syarat yang berbeda sedikit
 * saja, ada tombstone yang hilang tanpa pernah dicatat — dan itulah satu-satunya
 * cara sejarah bisa berbohong.
 */
const DOOMED_WHERE = "deleted = 1 AND updated_at < $1";

/**
 * Kompaksi tombstone: sejarah tidak bisa lagi ditarik dari bawah rev yang
 * dihapus di sini, jadi setiap penghapusan harus menaikkan `floor` lebih dulu.
 *
 * Perangkat yang kursornya tertinggal di bawah floor dijawab 409 dan harus unduh
 * ulang penuh. Klien tidak boleh melakukan itu dengan membuang baris lokalnya
 * yang masih `dirty`: unduh ulang penuh terjadi sesudah push bersih.
 */
export function compactionStatements(cutoffMicros: number): Statement[] {
  return TABLES.map((table) => ({
    text: `DELETE FROM ${identifier(table)} WHERE ${DOOMED_WHERE}`,
    args: [cutoffMicros],
  }));
}

/**
 * Titik terendah yang masih boleh dilayani sebuah unduhan: rev PALING TINGGI di
 * antara tombstone yang akan dihapus, per pemilik.
 *
 * Bukan rev terendah dari yang masih tersisa. Yang perlu diketahui klien adalah
 * "adakah baris yang seharusnya ia terima tapi sudah tidak ada di sini": kalau
 * seluruh yang terhapus punya rev di bawah kursornya, deltas-nya masih benar
 * semuanya, dan 409 hanya akan memaksa unduh ulang yang tidak perlu. Sebaliknya,
 * ketika yang tersisa sudah tidak ada lagi, `MIN` atas himpunan kosong akan
 * menyeret floor turun ke nol dan menghapus jejak penghapusan yang baru saja
 * kita lakukan — persis lubang yang ditutup berkas ini.
 *
 * Jalan dalam transaksi yang sama, SEBELUM penghapusan: ia membaca baris yang
 * masih ada. `GREATEST` menjaga floor hanya naik, dan pemilik yang tidak punya
 * apa-apa yang doomed tidak tersentuh.
 */
export function floorBumpStatement(cutoffMicros: number): Statement {
  const doomed = TABLES.map(
    (table) => `SELECT owner_id, rev FROM ${identifier(table)} WHERE ${DOOMED_WHERE}`,
  ).join(" UNION ALL ");
  return {
    text:
      `INSERT INTO sync_floor (owner_id, floor_rev, updated_at) ` +
      `SELECT owner_id, MAX(rev), ${NOW_MICROS} FROM (${doomed}) bakal GROUP BY owner_id ` +
      `ON CONFLICT (owner_id) DO UPDATE SET ` +
      `floor_rev = GREATEST(sync_floor.floor_rev, EXCLUDED.floor_rev), updated_at = ${NOW_MICROS}`,
    args: [cutoffMicros],
  };
}

/** Sepasang kalimat untuk satu putaran perapian: catat dulu, baru hapus. */
export function compactionPlan(cutoffMicros: number): Statement[] {
  return [floorBumpStatement(cutoffMicros), ...compactionStatements(cutoffMicros)];
}

export function floorReadStatement(owner: string): Statement {
  return {
    text: "SELECT floor_rev FROM sync_floor WHERE owner_id = $1",
    args: [owner],
  };
}

/** Nomor antrean sekali tarik untuk satu batch, jadi hanya satu bolak-balik. */
export function revsStatement(count: number): Statement {
  return {
    text: `SELECT nextval('sync_rev_seq') AS rev FROM generate_series(1, $1)`,
    args: [count],
  };
}

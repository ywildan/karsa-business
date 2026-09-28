import assert from "node:assert/strict";
import test from "node:test";

import { TABLES, payloadColumnsOf } from "./protocol.ts";
import type { PlannedWrite } from "./sync.ts";
import {
  bindStatement,
  compactionPlan,
  compactionStatements,
  floorBumpStatement,
  identifier,
  insertStatement,
  licenseStatement,
  principalStatement,
  pullStatement,
  revsStatement,
  trialBalanceStatement,
} from "./sql.ts";

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const PARTY = "22222222-2222-4222-8222-222222222222";
const DEVICE = "33333333-3333-4333-8333-333333333333";

/** Kalimat satu baris kiriman, dengan nama yang berbahaya di kolom teks. */
const HOSTILE = "Robert'); DROP TABLE party; --";

function write(table: (typeof TABLES)[number], name: string): PlannedWrite {
  const values: Record<string, string | number | null> = { id: PARTY };
  for (const column of payloadColumnsOf(table)) {
    if (column === "id") continue;
    values[column] = column === "name" ? name : column.endsWith("_id") ? BUSINESS : column === "device_id" ? DEVICE : 0;
  }
  return { table, id: PARTY, owner: "pemilik-a", rev: 7, values };
}

test("pengenal di luar daftar izin tidak pernah jadi teks", () => {
  for (const attempt of ["party; DROP TABLE x", "rev --", "", "id)", "SYNC_REV_SEQ", "table"]) {
    assert.throws(() => identifier(attempt), /di luar daftar izin/, attempt);
  }
  assert.equal(identifier("party"), "party");
  assert.equal(identifier("cash_account_code"), "cash_account_code");
});

test("isi minta pengguna tidak pernah masuk ke teks SQL", () => {
  const statement = insertStatement(write("party", HOSTILE));
  assert.ok(!statement.text.includes(HOSTILE), "teks SQL memuat apa yang diketik pengguna");
  assert.ok(statement.args.includes(HOSTILE), "nilangnya hilang");
  assert.ok(statement.text.includes("INSERT INTO party"));
});

test("penomoran copot sama banyaknya dengan kolom", () => {
  for (const table of TABLES) {
    const statement = insertStatement(write(table, "biasa"));
    const marks = [...statement.text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    assert.deepEqual(
      marks,
      marks.map((_, index) => index + 1),
      `${table}: copot tidak berurutan`,
    );
    assert.equal(statement.args.length, marks.length, table);
  }
});

test("nama tabel dan kolom yang muncul di teks semuanya terizin", () => {
  const statement = insertStatement(write("ledger_entry", "biasa"));
  const names = [...new Set([...statement.text.matchAll(/\b([a-z_][a-z0-9_]*)\b/g)].map((m) => m[1] as string))];
  const reserved = new Set([
    "insert", "into", "values", "on", "conflict", "do", "update", "set", "excluded", "owner_id", "id", "rev",
  ]);
  for (const name of names) {
    if (reserved.has(name)) continue;
    assert.doesNotThrow(() => identifier(name), `teks memuat ${name}`);
  }
});

test("tanggal dibuat tidak ditimpa oleh kirim ulang", () => {
  const statement = insertStatement(write("item", "biasa"));
  const assigned = (statement.text.split("DO UPDATE SET")[1] ?? "")
    .split(", ")
    .map((pair) => (pair.split(" = ")[0] ?? "").trim());
  for (const kept of ["owner_id", "id", "created_at"]) {    assert.ok(!assigned.includes(kept), `${kept} tidak boleh ditimpa`);
  }
  for (const refreshed of ["rev", "updated_at", "device_id", "name", "sale_price"]) {
    assert.ok(assigned.includes(refreshed), `${refreshed} harus ikut naik`);
  }
});

test("kunci tabraknya pasangan pemilik dan id", () => {
  for (const table of TABLES) {
    assert.match(insertStatement(write(table, "biasa")).text, /ON CONFLICT \(owner_id, id\)/);
  }
});

test("satu unduhan mengambil semua tabel sekaligus", () => {
  const statement = pullStatement("pemilik-a", 40, 500);
  for (const table of TABLES) {
    assert.ok(statement.text.includes(`FROM ${table} t`), table);
    assert.ok(statement.text.includes(`t.owner_id = $1`), table);
    assert.ok(statement.text.includes("t.rev > $2"), table);
  }
  assert.deepEqual(statement.args, ["pemilik-a", 40, 500]);
  assert.match(statement.text, /ORDER BY rev ASC LIMIT \$3/);
  assert.ok(!statement.text.includes("$4"), "copot lebih banyak dari argumennya");
});

test("baris server tidak ikut terkumpul dalam muatan unduhan", () => {
  const statement = pullStatement("pemilik-a", 0, 10);
  const cuts = [...statement.text.matchAll(/to_jsonb\(t\) - '([a-z_]+)'/g)].map((m) => m[1] as string);
  assert.equal(cuts.length, TABLES.length);
  for (const cut of cuts) assert.equal(cut, "owner_id");
  assert.ok(statement.text.includes("- 'rev'"));
});

/**
 * Guard khusus satu kelas bug yang nyata di PostgreSQL: kata kunci cadangan
 * boleh muncul setelah `AS`, tapi tidak boleh dipakai sebagai acuan polos.
 * Kalimat luar membaca hasil subquery tanpa tanda kutip, jadi nama kolomnya
 * harus kata yang bebas. Versi pertama berkas ini memakai `table` dan `values`
 * dan baru meledak saat dijalankan di Neon.
 */
test("acuan polos di kalimat unduhan bukan kata kunci cadangan", () => {
  const reserved = new Set([
    "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric",
    "both", "case", "cast", "check", "collate", "column", "constraint", "create",
    "default", "deferrable", "desc", "distinct", "do", "else", "end", "except",
    "false", "for", "foreign", "from", "grant", "group", "having", "in", "initially",
    "intersect", "into", "lateral", "leading", "limit", "localtime", "localtimestamp",
    "not", "null", "offset", "on", "only", "or", "order", "placing", "primary",
    "references", "returning", "select", "session_user", "some", "symmetric",
    "system_user", "table", "then", "to", "trailing", "true", "union", "unique",
    "user", "using", "variadic", "when", "where", "window", "with", "owner", "values",
  ]);
  const statement = pullStatement("pemilik-a", 0, 10);
  const projection = /^SELECT ([a-z_, ]+) FROM \(/.exec(statement.text);
  assert.ok(projection, `kalimat luar tidak terbaca: ${statement.text.slice(0, 48)}`);
  const names = (projection[1] ?? "").split(",").map((entry) => entry.trim());
  assert.deepEqual(names, ["tbl", "id", "rev", "payload"]);
  for (const name of names) {
    assert.ok(!reserved.has(name), `${name} kata kunci cadangan, tidak bisa jadi acuan polos`);
  }
});

test("kompaksi hanya menyentuh tombstone", () => {
  const statements = compactionStatements(9_000);
  assert.equal(statements.length, TABLES.length);
  for (const statement of statements) {
    assert.match(statement.text, /WHERE deleted = 1 AND updated_at < \$1/);
    assert.deepEqual(statement.args, [9_000]);
  }
});

test("yang dihapus dan yang dicatat punya syarat yang sama persis", () => {
  // Kalau keduanya sampai berbeda — meski cuma tanda `<` — ada tombstone yang
  // hilang tanpa menaikkan floor, dan perangkat di bawah rev-nya tidak pernah
  // tahu barisnya seharusnya sudah mati.
  const predicate = /deleted = 1 AND updated_at < \$1/;
  const bump = floorBumpStatement(9_000).text;
  assert.equal((bump.match(new RegExp(predicate.source, "g")) ?? []).length, TABLES.length);
  for (const statement of compactionStatements(9_000)) {
    assert.match(statement.text, predicate);
    assert.match(bump, predicate);
  }
});

test("floor naik ke rev tertinggi yang dihapus, bukan yang tersisa", () => {
  const statement = floorBumpStatement(9_000);
  assert.match(statement.text, /SELECT owner_id, MAX\(rev\)/);
  assert.match(statement.text, /GROUP BY owner_id/);
  assert.match(statement.text, /GREATEST\(sync_floor\.floor_rev, EXCLUDED\.floor_rev\)/);
  assert.deepEqual(statement.args, [9_000]);
  // Tidak ada COALESCE(..., 0): pemilik tanpa tombstone tidak boleh tersentuh,
  // dan menurunkan floor adalah cara paling singkat membangkitkan baris mati.
  assert.ok(!statement.text.includes("COALESCE"), "floor bisa turun");
});

test("perapian mencatat sebelum menghapus, dalam satu rencana", () => {
  const plan = compactionPlan(9_000);
  assert.equal(plan.length, TABLES.length + 1);
  assert.match(plan[0]!.text, /^INSERT INTO sync_floor/);
  assert.match(plan[1]!.text, /^DELETE FROM/);
});

test("nomor antrean ditarik sekaligus untuk satu batch", () => {
  const statement = revsStatement(200);
  assert.match(statement.text, /generate_series\(1, \$1\)/);
  assert.deepEqual(statement.args, [200]);
});

test("lisensi dicari lewat hash, kode tidak pernah lewat sini", () => {
  const statement = licenseStatement("abc123");
  assert.match(statement.text, /WHERE code_hash = \$1/);
  assert.ok(!statement.text.includes("code_hash = 'abc"));
  assert.deepEqual(statement.args, ["abc123"]);
});

test("pemilik dibaca dari perangkat yang terikat, bukan dari lisensi saja", () => {
  const statement = principalStatement("hash-token");
  assert.match(statement.text, /FROM device d/);
  assert.match(statement.text, /l\.revoked_at IS NULL/);
  assert.deepEqual(statement.args, ["hash-token"]);
});

test("menempa ulang perangkat mengganti tokennya, bukan slotnya", () => {
  const statement = bindStatement({
    owner: "pemilik-a",
    deviceId: DEVICE,
    codeHash: "hash-kode",
    tokenHash: "hash-baru",
    licensedAtMicros: 10,
  });
  assert.match(statement.text, /ON CONFLICT \(owner_id, device_id\) DO UPDATE/);
  assert.match(statement.text, /token_hash = EXCLUDED\.token_hash/);
  assert.ok(!statement.text.includes("licensed_at = EXCLUDED"), "tanggal slot pertama dipertahankan");
  assert.deepEqual(statement.args, ["pemilik-a", DEVICE, "hash-kode", "hash-baru", 10]);
  // Stempel "kapan terakhir diikat" bukan angka yang dikirim dari isolat: dua
  // isolat punya jam yang bisa bergeser, basis data tidak.
  assert.match(statement.text, /extract\(epoch from now\(\)\)/);
});

test("stempel catatan di semua kalimat milik jam basis data", () => {
  const checks: Record<string, string> = {
    perangkat: bindStatement({
      owner: "pemilik-a",
      deviceId: DEVICE,
      codeHash: "hash-kode",
      tokenHash: "hash-baru",
      licensedAtMicros: 10,
    }).text,
    lantai: floorBumpStatement(9_000).text,
  };
  for (const [name, text] of Object.entries(checks)) {
    assert.match(text, /updated_at/, name);
    assert.match(text, /extract\(epoch from now\(\)\)/, `${name}: updated_at tanpa sumber waktu`);
    assert.ok(!text.includes("$6"), `${name}: jam diselundupkan sebagai argumen`);
  }
});

test("neraca saldo dikelompokkan per akun dan dikunci ke satu pemilik", () => {
  const statement = trialBalanceStatement("pemilik-a", BUSINESS);
  assert.match(statement.text, /WHERE l\.owner_id = \$1 AND l\.business_id = \$2/);
  assert.match(statement.text, /GROUP BY l\.account_code/);
  assert.ok(statement.text.includes("l.deleted = 0"));
  assert.ok(statement.text.includes("e.deleted = 0"));
  assert.deepEqual(statement.args, ["pemilik-a", BUSINESS]);
});

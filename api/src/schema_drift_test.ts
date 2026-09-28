/**
 * Segitiga yang tidak boleh miring.
 *
 * Ada tiga salinan daftar kolom di repo ini: `SyncProtocol.wireColumns` di Dart,
 * `WIRE_COLUMNS` di TypeScript, dan DDL di dua tempat (SQLite untuk hp, Neon
 * untuk server). Uji di `app/test/sync_protocol_test.dart` sudah mengunci sisi
 * perangkat. Yang di sini mengunci sisi server — dan membacakan berkas Dart itu
 * apa adanya, karena satu daftar yang bergeser di satu sisi adalah baris yang
 * hilang diam-diam di sisi lain.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAX_TEXT_LENGTH,
  PUSH_BATCH,
  PULL_PAGE,
  SERVER_OWNED,
  STAMPED_COLUMNS,
  TABLES,
  TOMBSTONE_RETENTION_DAYS,
  WIRE_COLUMNS,
  payloadColumnsOf,
} from "./protocol.ts";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

function quotedTokens(block: string): string[] {
  return [...block.matchAll(/'([a-z_0-9]+)'/g)].map((match) => match[1] as string);
}

/** Membaca `wireColumns` dari `sync_protocol.dart`, satu baris atau banyak. */
function dartWireColumns(text: string): Map<string, string[]> {
  const start = text.indexOf("wireColumns = {");
  assert.notEqual(start, -1, "wireColumns tidak ditemukan di Dart");
  const block = text.slice(start, text.indexOf("};", start));
  const found = new Map<string, string[]>();
  for (const entry of block.matchAll(/'([a-z_]+)':\s*\[([\s\S]*?)\]/g)) {
    found.set(entry[1] as string, quotedTokens(entry[2] as string));
  }
  return found;
}

function dartList(text: string, name: string): string[] {
  const open = new RegExp(`${name}\\s*=\\s*[\\[{]`).exec(text);
  assert.ok(open, `${name} tidak ditemukan di Dart`);
  const start = open.index + open[0].length;
  const end = text.indexOf(text[start - 1] === "{" ? "}" : "]", start);
  return quotedTokens(text.slice(start, end));
}

function dartInt(text: string, name: string): number {
  const match = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(text);
  assert.ok(match, `${name} tidak ditemukan di Dart`);
  return Number(match[1]);
}

/** Membaca daftar kolom tiap `create table` dari DDL Postgres. */
function sqlColumns(text: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const table of text.matchAll(
    /create table if not exists ([a-z_]+) \(([\s\S]*?)\n\);/g,
  )) {
    const columns: string[] = [];
    for (const line of (table[2] as string).split("\n")) {
      const trimmed = line.trim().replace(/,$/, "");
      const first = trimmed.split(/\s+/)[0] ?? "";
      if (!/^[a-z_]+$/.test(first)) continue;
      if (["primary", "unique", "check", "foreign", "constraint"].includes(first)) {
        continue;
      }
      columns.push(first);
    }
    found.set(table[1] as string, columns);
  }
  return found;
}

/** Membaca DDL SQLite dari `db.dart`, dengan `$_syncColumns` dikembangkan. */
function sqliteTables(text: string): Map<string, string[]> {
  const names = new Map<string, string>();
  for (const entry of text.matchAll(/static const String (table\w+) = '([a-z_]+)'/g)) {
    names.set(entry[1] as string, entry[2] as string);
  }
  const shared = /const String _syncColumns = '''([\s\S]*?)'''/.exec(text)?.[1];
  assert.ok(shared, "_syncColumns tidak ditemukan");
  const expanded = text.replaceAll("$_syncColumns", shared);
  const found = new Map<string, string[]>();
  for (const block of expanded.matchAll(/CREATE TABLE \$(\w+)\s*\(([\s\S]*?)\)\s*'''/g)) {
    const name = names.get(block[1] as string) ?? block[1];
    const columns: string[] = [];
    for (const line of (block[2] as string).split("\n")) {
      const trimmed = line.trim().replace(/,$/, "");
      const first = trimmed.split(/\s+/)[0] ?? "";
      if (!/^[a-z_]+$/.test(first)) continue;
      if (["primary", "unique", "check", "foreign", "constraint"].includes(first)) continue;
      columns.push(first);
    }
    found.set(name, columns);
  }
  return found;
}

const DART = source("../../app/lib/domain/sync_protocol.dart");
const SQLITE = source("../../app/lib/data/db.dart");
const MIGRATION = source("../../migrations/0001_init.sql");

test("angka protokol sama di kedua bahasa", () => {
  assert.equal(PUSH_BATCH, dartInt(DART, "pushBatch"));
  assert.equal(PULL_PAGE, dartInt(DART, "pullPage"));
  assert.equal(TOMBSTONE_RETENTION_DAYS, dartInt(DART, "tombstoneRetentionDays"));
  assert.ok(MAX_TEXT_LENGTH > 0);
});

test("daftar tabel kiriman sama persis, termasuk urutannya", () => {
  assert.deepEqual(TABLES, [...dartWireColumns(DART).keys()]);
});

test("daftar kolom kiriman sama persis per tabel", () => {
  const dart = dartWireColumns(DART);
  assert.equal(dart.size, TABLES.length);
  for (const table of TABLES) {
    assert.deepEqual(
      [...(dart.get(table) ?? [])].sort(),
      [...(WIRE_COLUMNS[table] as readonly string[])].sort(),
      table,
    );
  }
});

test("kolom yang di-stempel dan milik server sama persis", () => {
  assert.deepEqual(STAMPED_COLUMNS, dartList(DART, "stampedColumns"));
  assert.deepEqual(SERVER_OWNED, dartList(DART, "serverOwned").sort());
});

test("Neon menyimpan persis kolom kiriman ditambah kunci server", () => {
  const ddl = sqlColumns(MIGRATION);
  for (const table of TABLES) {
    const expected = ["owner_id", ...payloadColumnsOf(table), "rev"].sort();
    assert.deepEqual(
      [...(ddl.get(table) ?? [])].sort(),
      expected,
      `${table}: skema server bergeser dari protokol`,
    );
  }
});

test("dirty tidak punya tempat di server", () => {
  for (const table of TABLES) {
    assert.ok(!payloadColumnsOf(table).includes("dirty"), table);
    assert.ok(!SERVER_OWNED.includes("dirty"));
  }
  assert.ok(!/^\s*dirty\s/m.test(MIGRATION), "DDL server jangan punya kolom dirty");
});

test("tabel khusus perangkat tidak pernah dibuat di server", () => {
  const ddl = sqlColumns(MIGRATION);
  assert.equal(ddl.has("meta"), false);
  assert.equal(ddl.has("license"), true);
  assert.equal(ddl.has("device"), true);
  assert.equal(ddl.has("sync_floor"), true);
});

/** Semua `grant` yang benar-benar dijalankan, bukan yang di komentar. */
function grantLines(sql: string): string[] {
  const executable = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  return [...executable.matchAll(/(grant|revoke)[^;]+;/gi)].map((match) => match[0]);
}

test("tabel lisensi tidak diserahkan ke peran mana pun lewat migrasi", () => {
  assert.deepEqual(
    grantLines(MIGRATION).filter((line) => /\blicense\b/.test(line)),
    [],
    "penerbitan kode jalurnya psql, bukan hak akses yang diberikan migrasi ini",
  );
});

test("DDL server adalah cermin DDL perangkat, kurang dua kunci dan kurang dirty", () => {
  const sqlite = sqliteTables(SQLITE);
  const neon = sqlColumns(MIGRATION);
  for (const table of TABLES) {
    const local = (sqlite.get(table) ?? []).filter((column) => column !== "dirty");
    const remote = (neon.get(table) ?? []).filter(
      (column) => column !== "owner_id" && column !== "rev",
    );
    assert.deepEqual([...remote].sort(), [...local].sort(), table);
  }
});

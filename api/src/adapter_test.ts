import assert from "node:assert/strict";
import test from "node:test";

import { neonStore, type Ask, type AskMany, type Row } from "./adapter.ts";
import { payloadColumnsOf, type Table } from "./protocol.ts";
import type { PlannedWrite } from "./sync.ts";
import { insertStatement, type Statement } from "./sql.ts";

/**
 * Pengganti Neon yang hanya mencatat kalimat dan mengembalikan baris yang
 * dituliskan tes. Bentuk barisnya sengaja meniru apa yang keluar dari driver
 * `pg`: `int8` dan `numeric` sebagai STRING, `to_jsonb` sebagai objek, dan
 * `revoked` sebagai boolean.
 *
 * Semua yang diuji di berkas ini adalah bagian yang salah kalau diasumsikan —
 * dan tidak ada satu pun yang butuh akun cloud.
 */

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const PARTY = "22222222-2222-4222-8222-222222222222";
const DEVICE = "33333333-3333-4333-8333-333333333333";

type Recorded = { text: string; args: readonly unknown[] };

function fake(pages: Row[][]) {
  const asked: Recorded[] = [];
  const batches: Recorded[][] = [];
  let next = 0;

  const ask: Ask = async (text, args) => {
    asked.push({ text, args });
    const page = pages[next];
    next += 1;
    if (page === undefined) throw new Error(`tes tidak menyiapkan halaman ke-${next}`);
    return page;
  };

  const askMany: AskMany = async (statements: readonly Statement[]) => {
    batches.push(statements.map((statement) => ({ text: statement.text, args: statement.args })));
    return statements.map(() => []);
  };

  return { store: neonStore({ ask, askMany }), asked, batches };
}

function writeFor(table: Table): PlannedWrite {
  const values: Record<string, string | number | null> = {};
  for (const column of payloadColumnsOf(table)) {
    values[column] = column === "id" ? PARTY : column === "name" ? "Rina" : column.endsWith("_id") ? BUSINESS : 1;
  }
  return { table, id: PARTY, owner: "pemilik-a", rev: 9, values };
}

test("nomor antrean yang datang sebagai teks jadi angka", async () => {
  const { store, asked } = fake([[{ rev: "1" }, { rev: "2" }, { rev: "3" }]]);
  assert.deepEqual(await store.claimRevs(3), [1, 2, 3]);
  assert.deepEqual(asked[0]?.args, [3]);
  assert.match(asked[0]!.text, /nextval\('sync_rev_seq'\)/);
});

test("batch kosong tidak mengetuk basis data sama sekali", async () => {
  const { store, asked, batches } = fake([]);
  await store.applyWrites([]);
  assert.equal(asked.length, 0);
  assert.equal(batches.length, 0);
});

test("seluruh tulis mendarat dalam satu transaksi", async () => {
  const { store, batches } = fake([]);
  const writes = [writeFor("business"), writeFor("party"), writeFor("ledger_line")];
  await store.applyWrites(writes);
  assert.equal(batches.length, 1, "harus satu kali jalan, bukan tiga");
  const statements = batches[0]!;
  assert.equal(statements.length, 3);
  for (const [index, statement] of statements.entries()) {
    assert.deepEqual(statement, insertStatement(writes[index]!), `kalimat ke-${index}`);
    assert.deepEqual(statement.args.slice(0, 3), ["pemilik-a", PARTY, 9], "pemilik dan antrean paling depan");
  }
});

test("baris unduhan diterjemahkan tanpa memercayai isinya", async () => {
  const { store } = fake([
    [
      {
        tbl: "party",
        id: PARTY,
        rev: "17",
        payload: {
          id: PARTY,
          business_id: BUSINESS,
          name: "Rina",
          phone: null,
          note: null,
          created_at: 1,
          updated_at: 2,
          deleted: 0,
          device_id: DEVICE,
          // Yang bukan skalar tidak boleh ikut terbang ke perangkat.
          aneh: { dalam: "objek" },
          daftar: [1, 2],
        },
      },
    ],
  ]);
  const rows = await store.rowsSince("pemilik-a", 10, 500);
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.table, "party");
  assert.equal(row.rev, 17, "rev teks harus jadi angka, kalau tidak urutannya salah diam-diam");
  assert.equal(row.owner, "pemilik-a", "pemilik diambil dari pertanyaan");
  assert.equal(row.values["name"], "Rina");
  assert.equal(row.values["phone"], null);
  assert.equal("aneh" in row.values, false, "muatan bersarang lolos");
  assert.equal("daftar" in row.values, false, "muatan berdaftar lolos");
});

test("tabel yang tidak ada di daftar izin berbunyi, tidak dikirim", async () => {
  const { store } = fake([[{ tbl: "rahasa", id: PARTY, rev: "1", payload: {} }]]);
  await assert.rejects(() => store.rowsSince("pemilik-a", 0, 10), /di luar daftar izin/);
});

test("floor yang belum pernah ada adalah nol", async () => {
  const kosong = fake([[]]);
  assert.equal(await kosong.store.floorRev("pemilik-a"), 0);
  const ada = fake([[{ floor_rev: "42" }]]);
  assert.equal(await ada.store.floorRev("pemilik-a"), 42);
});

test("lisensi dibaca dari kolom yang benar, termasuk flag yang bisa berupa teks", async () => {
  const { store, asked } = fake([[
    {
      code_hash: "hash",
      owner_id: BUSINESS,
      edition: "pro",
      revoked: "f",
      max_devices: "5",
    },
  ]]);
  const license = await store.licenseByCodeHash("hash");
  assert.deepEqual(license, {
    codeHash: "hash",
    owner: BUSINESS,
    edition: "pro",
    revoked: false,
    maxDevices: 5,
  });
  assert.deepEqual(asked[0]?.args, ["hash"], "kode dicari lewat hash-nya");

  const cabut = fake([[{ code_hash: "hash", owner_id: BUSINESS, edition: "pro", revoked: "t", max_devices: 3 }]]);
  assert.equal((await cabut.store.licenseByCodeHash("hash"))?.revoked, true);
});

test("kode yang tidak ada tidak menghasilkan rekaman", async () => {
  const { store } = fake([[]]);
  assert.equal(await store.licenseByCodeHash("hash-asing"), null);
});

test("pemilik token dibaca dari perangkat yang terikat", async () => {
  const { store, asked } = fake([[{ owner: BUSINESS, device_id: DEVICE, edition: "free" }]]);
  assert.deepEqual(await store.principalByTokenHash("hash-token"), {
    owner: BUSINESS,
    deviceId: DEVICE,
    edition: "free",
  });
  assert.match(asked[0]!.text, /l\.revoked_at IS NULL/);
});

test("edisi yang tidak dikenal tidak dapat izin apa pun", async () => {
  const { store } = fake([[{ owner: BUSINESS, device_id: DEVICE, edition: "sangat_pro" }]]);
  await assert.rejects(() => store.principalByTokenHash("hash-token"), /edisi lisensi tidak dikenal/);
});

test("menempa perangkat memakai jam basis data, bukan jam isolat", async () => {
  const { store, asked } = fake([[]]);
  await store.bindDevice({
    owner: "pemilik-a",
    deviceId: DEVICE,
    codeHash: "hash-kode",
    tokenHash: "hash-token",
    licensedAtMicros: 1_700_000_000_000_000,
  });
  const statement = asked[0]!;
  assert.deepEqual(statement.args, ["pemilik-a", DEVICE, "hash-kode", "hash-token", 1_700_000_000_000_000]);
  assert.match(statement.text, /extract\(epoch from now\(\)\)/);
});

test("neraca saldo mengubah numeric menjadi angka", async () => {
  const { store, asked } = fake([[
    { account_code: "1100", name: "Kas", debit: "300000", credit: "0" },
    { account_code: "3100", name: null, debit: "0", credit: "300000" },
  ]]);
  const rows = await store.trialBalance("pemilik-a", BUSINESS);
  assert.deepEqual(rows, [
    { account_code: "1100", name: "Kas", debit: 300_000, credit: 0 },
    { account_code: "3100", name: "", debit: 0, credit: 300_000 },
  ]);
  assert.deepEqual(asked[0]?.args, ["pemilik-a", BUSINESS]);
});

test("kolom yang hilang bukan nol", async () => {
  // `int(undefined)` harus berbunyi. Kalau ia diam-diam jadi 0, seorang pemilik
  // bisa mendapat rev 0 dan perangkatnya mengira sejarahnya masih utuh.
  const { store } = fake([[{ owner: BUSINESS, device_id: DEVICE }]]);
  await assert.rejects(() => store.principalByTokenHash("hash"), /edisi lisensi tidak dikenal/);

  const kosong = fake([[{ floor_rev: null }]]);
  await assert.rejects(() => kosong.store.floorRev("pemilik-a"), /angka diharapkan/);
});

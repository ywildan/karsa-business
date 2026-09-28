import assert from "node:assert/strict";
import test from "node:test";

import {
  ProtocolError,
  parsePushBody,
  planPull,
  planPush,
  pullLimit,
  pullResync,
  pullSince,
  type CleanRow,
  type PullContext,
  type StoredRow,
} from "./sync.ts";
import { MAX_TEXT_LENGTH, PULL_PAGE } from "./protocol.ts";

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const PARTY = "22222222-2222-4222-8222-222222222222";
const DEVICE = "33333333-3333-4333-8333-333333333333";
const OTHER_DEVICE = "44444444-4444-4444-8444-444444444444";
const ENTRY = "55555555-5555-4555-8555-555555555555";

function partyRow(overrides: Record<string, unknown> = {}): CleanRow {
  const values: Record<string, unknown> = {
    id: PARTY,
    business_id: BUSINESS,
    name: "Rina",
    phone: null,
    note: null,
    created_at: 1000,
    updated_at: 2000,
    deleted: 0,
    device_id: OTHER_DEVICE,
    ...overrides,
  };
  return parsePushBody({ rows: [{ table: "party", id: PARTY, values }] })[0] as CleanRow;
}

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (problem) {
    assert.ok(problem instanceof ProtocolError, `bukan ProtocolError: ${String(problem)}`);
    return problem.code;
  }
  assert.fail("minta tidak ditolak");
}

test("satu baris yang sah lolos apa adanya", () => {
  const rows = parsePushBody({
    rows: [
      {
        table: "party",
        id: PARTY,
        values: { id: PARTY, business_id: BUSINESS, name: "Rina", created_at: 1, updated_at: 2, deleted: 0, device_id: DEVICE },
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.values["name"], "Rina");
});

test("kolom milik server dan kolom lokal ditolak dengan nama yang berbeda", () => {
  for (const [column, code] of [
    ["rev", "server_column"],
    ["owner_id", "server_column"],
    ["dirty", "local_column"],
  ] as const) {
    const values: Record<string, unknown> = { id: PARTY, business_id: BUSINESS, name: "Rina", created_at: 1, updated_at: 2, deleted: 0, device_id: DEVICE, [column]: 7 };
    const body = { rows: [{ table: "party", id: PARTY, values }] };
    assert.equal(codeOf(() => parsePushBody(body)), code, column);
  }
});

test("yang asing ditolak, bukan dibuang diam-diam", () => {
  assert.equal(
    codeOf(() => parsePushBody({ rows: [{ table: "warung", id: PARTY, values: {} }] })),
    "unknown_table",
  );
  assert.equal(
    codeOf(() => parsePushBody({ rows: [{ table: "party", id: PARTY, values: { ane: "x" } }] })),
    "unknown_column",
  );
});

test("bentuk iuran yang salah tidak lolos", () => {
  const cases: [string, unknown, string][] = [
    ["bukan objek", "rows", "body_shape"],
    ["rows bukan daftar", { rows: {} }, "body_shape"],
    ["baris bukan objek", { rows: ["x"] }, "row_shape"],
    ["id bukan uuid", { rows: [{ table: "party", id: "satu", values: {} }] }, "bad_id"],
    ["id dan values.id beda", { rows: [{ table: "party", id: PARTY, values: { id: BUSINESS } }] }, "id_mismatch"],
    ["kolom wajib hilang", { rows: [{ table: "party", id: PARTY, values: { id: PARTY, business_id: BUSINESS, created_at: 1, updated_at: 2, deleted: 0, device_id: DEVICE } }] }, "missing_column"],
    ["null di kolom wajib", { rows: [{ table: "party", id: PARTY, values: { id: PARTY, business_id: BUSINESS, name: null, created_at: 1, updated_at: 2, deleted: 0, device_id: DEVICE } }] }, "null_required"],
    ["pecahan di kolom rupiah", { rows: [{ table: "party", id: PARTY, values: { id: PARTY, business_id: BUSINESS, name: "Rina", created_at: 1.5, updated_at: 2, deleted: 0, device_id: DEVICE } }] }, "bad_int"],
    ["teks sepanjang novel", { rows: [{ table: "party", id: PARTY, values: { id: PARTY, business_id: BUSINESS, name: "a".repeat(MAX_TEXT_LENGTH + 1), created_at: 1, updated_at: 2, deleted: 0, device_id: DEVICE } }] }, "too_long"],
    ["device_id bukan uuid", { rows: [{ table: "party", id: PARTY, values: { id: PARTY, business_id: BUSINESS, name: "Rina", created_at: 1, updated_at: 2, deleted: 0, device_id: "saya" } }] }, "bad_uuid"],
  ];
  for (const [name, body, code] of cases) {
    assert.equal(codeOf(() => parsePushBody(body)), code, name);
  }
});

test("batch yang lebih besar dari dua halaman klien ditolak", () => {
  const rows = Array.from({ length: 501 }, () => ({
    table: "party",
    id: PARTY,
    values: { id: PARTY, business_id: BUSINESS, name: "Rina", created_at: 1, updated_at: 2, deleted: 0, device_id: DEVICE },
  }));
  assert.equal(codeOf(() => parsePushBody({ rows })), "too_many_rows");
});

test("baris jurnal dijaga sisinya", () => {
  const line = (values: Record<string, unknown>): string =>
    codeOf(() =>
      parsePushBody({
        rows: [
          {
            table: "ledger_line",
            id: PARTY,
            values: {
              id: PARTY,
              entry_id: ENTRY,
              business_id: BUSINESS,
              account_code: "1100",
              debit: 0,
              credit: 0,
              created_at: 1,
              updated_at: 2,
              deleted: 0,
              device_id: DEVICE,
              ...values,
            },
          },
        ],
      }),
    );
  assert.equal(line({ debit: 0, credit: 0 }), "unbalanced_line", "nol di kedua sisi");
  assert.equal(line({ debit: 5, credit: 5 }), "unbalanced_line", "kedua sisi terisi");
  assert.equal(line({ debit: -5, credit: 0 }), "negative_amount");
  assert.equal(line({ account_code: "kas" }), "bad_account_code");
});

test("baris jurnal yang sah lolos, termasuk sub-akan", () => {
  const rows = parsePushBody({
    rows: [
      {
        table: "ledger_line",
        id: PARTY,
        values: { id: PARTY, entry_id: ENTRY, business_id: BUSINESS, account_code: "6200.01", debit: 40_000, credit: 0, created_at: 1, updated_at: 2, deleted: 0, device_id: DEVICE },
      },
      {
        table: "ledger_line",
        id: ENTRY,
        values: { id: ENTRY, entry_id: ENTRY, business_id: BUSINESS, account_code: "1100", debit: 0, credit: 40_000, created_at: 1, updated_at: 2, deleted: 0, device_id: DEVICE },
      },
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.values["account_code"], "6200.01");
});

test("pergerakan barang dijaga arah dan jumlahnya", () => {
  const movement = (values: Record<string, unknown>): string =>
    codeOf(() =>
      parsePushBody({
        rows: [
          {
            table: "stock_movement",
            id: PARTY,
            values: { id: PARTY, business_id: BUSINESS, item_id: ENTRY, entered_on: 1, direction: 1, quantity: 1, unit_cost: 0, created_at: 1, updated_at: 2, deleted: 0, device_id: DEVICE, ...values },
          },
        ],
      }),
    );
  assert.equal(movement({ direction: 0 }), "bad_direction");
  assert.equal(movement({ direction: 2 }), "bad_direction");
  assert.equal(movement({ quantity: 0 }), "bad_quantity");
  assert.equal(movement({ quantity: -3 }), "bad_quantity");
});

test("masuk dan keluar barang yang sah lolos", () => {
  const rows = parsePushBody({
    rows: [
      { table: "stock_movement", id: PARTY, values: { id: PARTY, business_id: BUSINESS, item_id: ENTRY, entered_on: 1, direction: 1, quantity: 3, unit_cost: 12_000, created_at: 1, updated_at: 2, deleted: 0, device_id: DEVICE } },
      { table: "stock_movement", id: ENTRY, values: { id: ENTRY, business_id: BUSINESS, item_id: ENTRY, entered_on: 2, direction: -1, quantity: 1, unit_cost: 12_000, entry_id: PARTY, created_at: 1, updated_at: 2, deleted: 0, device_id: DEVICE } },
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.values["direction"], -1);
  assert.equal(rows[1]?.values["entry_id"], PARTY);
});

test("nomor antrean menentukan urutan menang", () => {
  const writes = planPush(
    [partyRow({ name: "pertama" }), partyRow({ name: "kedua" })],
    { owner: "pemilik-a", device_id: DEVICE, revs: [7, 9], now_micros: 12345 },
  );
  assert.deepEqual(writes.map((write) => write.rev), [7, 9]);
  assert.equal(writes[0]?.values["name"], "pertama");
  assert.equal(writes[1]?.values["name"], "kedua");
});

test("perangkat tidak boleh memilih pemilik atau pengubahnya sendiri", () => {
  const [write] = planPush([partyRow({ device_id: OTHER_DEVICE, updated_at: 999 })], {
    owner: "pemilik-a",
    device_id: DEVICE,
    revs: [1],
    now_micros: 555,
  })!;
  assert.equal(write?.owner, "pemilik-a");
  assert.equal(write?.values["device_id"], DEVICE);
  assert.equal(write?.values["updated_at"], 555);
  assert.equal(write?.values["created_at"], 1000, "tanggal dibuat tetap laporan perangkat");
});

test("nomor antrean yang kurang jumlahnya membatalkan seluruh batch", () => {
  assert.throws(
    () => planPush([partyRow()], { owner: "o", device_id: DEVICE, revs: [], now_micros: 1 }),
    (problem: unknown) =>
      problem instanceof ProtocolError && problem.status === 500 && problem.code === "rev_shortage",
  );
  assert.throws(
    () => planPush([partyRow(), partyRow()], { owner: "o", device_id: DEVICE, revs: [5, 4], now_micros: 1 }),
    (problem: unknown) => problem instanceof ProtocolError && problem.code === "rev_unordered",
  );
});

function stored(rev: number, id: string, owner = "pemilik-a"): StoredRow {
  return {
    table: "party",
    id,
    owner,
    rev,
    values: { id, business_id: BUSINESS, name: `baris ${rev}`, created_at: 1, updated_at: rev * 10, deleted: 0, device_id: DEVICE, owner_id: owner, rev },
  };
}

function context(over: Partial<PullContext> = {}): PullContext {
  return { owner: "pemilik-a", since_rev: 0, limit: 10, floor_rev: 0, resync: false, ...over };
}

test("halaman unduhan menaik pada rev dan berhenti di limit", () => {
  const rows = [stored(30, PARTY), stored(10, PARTY), stored(20, PARTY)];
  const page = planPull(rows, context({ limit: 2 }));
  assert.deepEqual(page.rows.map((row) => row.rev), [10, 20]);
  assert.equal(page.next_rev, 20);
  assert.equal(page.has_more, true);
});

test("halaman terakhir tidak mengaku masih ada", () => {
  const page = planPull([stored(10, PARTY)], context({ since_rev: 5, limit: PULL_PAGE }));
  assert.equal(page.has_more, false);
  assert.equal(page.next_rev, 10);
});

test("rev dan pemilik tidak pernah ikut keluar", () => {
  const page = planPull([stored(10, PARTY)], context());
  const values = page.rows[0]?.values ?? {};
  assert.equal("rev" in values, false);
  assert.equal("owner_id" in values, false);
  assert.equal(values["updated_at"], 100, "cap server dipakai apa adanya");
});

test("baris milik orang lain membatalkan halaman, bukan lolos", () => {
  assert.throws(
    () => planPull([stored(10, PARTY, "pemilik-b")], context()),
    (problem: unknown) => problem instanceof ProtocolError && problem.status === 500 && problem.code === "foreign_row",
  );
});

test("sejarah yang sudah diringkas tidak disamarkan", () => {
  assert.throws(
    () => planPull([stored(90, PARTY)], context({ since_rev: 10, floor_rev: 50 })),
    (problem: unknown) => problem instanceof ProtocolError && problem.status === 409 && problem.code === "resync_required",
  );
  const ok = planPull([stored(90, PARTY)], context({ since_rev: 60, floor_rev: 50 }));
  assert.equal(ok.rows.length, 1);
  // since_rev 0 = sejarah penuh = cara memulihkan diri dari 409 di atas.
  const fromScratch = planPull([stored(90, PARTY)], context({ floor_rev: 50 }));
  assert.equal(fromScratch.rows.length, 1);
  assert.equal(fromScratch.next_rev, 90);
});

test("unduh ulang yang naik dari bawah floor tidak ditolak lagi", () => {
  // Halaman pertama sejarah penuh sudah menaikkan kursor klien ke 40, yang
  // masih di bawah floor. Menolak lagi berarti sesi berputar selamanya.
  const page = planPull([stored(90, PARTY)], context({ since_rev: 40, floor_rev: 50, resync: true }));
  assert.equal(page.rows.length, 1);
  assert.equal(page.next_rev, 90);
});

test("sejarah yang selesai dibaca menaikkan kursor sampai floor", () => {
  // Klien yang pulang dengan baris rev 40 saja tidak pernah tahu bahwa
  // tombstone sampai rev 70 sudah dibuang. Kalau kursornya dibiarkan 40,
  // sesi berikutnya kena 409 dan ia mengunduh ulang selamanya.
  const last = planPull([stored(40, PARTY)], context({ floor_rev: 70, resync: true }));
  assert.equal(last.has_more, false);
  assert.equal(last.next_rev, 70);

  const kosong = planPull([], context({ floor_rev: 70, resync: true }));
  assert.equal(kosong.rows.length, 0);
  assert.equal(kosong.next_rev, 70);

  // Selama masih ada halaman lanjutan, floor tidak boleh dipotong: baris di
  // atas floor belum sampai.
  const tengah = planPull([stored(40, PARTY), stored(80, PARTY)], context({ limit: 1, floor_rev: 70, resync: true }));
  assert.equal(tengah.has_more, true);
  assert.equal(tengah.next_rev, 40);
});

test("resync hanya dipercaya kalau benar-benar angka satu", () => {
  assert.equal(pullResync("1"), true);
  assert.equal(pullResync(null), false);
  assert.equal(pullResync(""), false);
  assert.equal(pullResync("0"), false);
  assert.equal(pullResync("ya"), false);
});

test("limit unduhan tidak bisa melewati plafon halaman", () => {
  assert.equal(pullLimit(null), PULL_PAGE);
  assert.equal(pullLimit("7"), 7);
  assert.equal(pullLimit("999999"), PULL_PAGE);
  assert.equal(pullSince(null), 0);
  assert.equal(pullSince("41"), 41);
  assert.equal(codeOf(() => pullLimit("-1")), "bad_limit");
  assert.equal(codeOf(() => pullSince("abc")), "bad_since");
});

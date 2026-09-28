import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";

import { handle, type Deps } from "./http.ts";
import { MemoryStore } from "./memory.ts";
import { LIMITS, type Counters } from "./ratelimit.ts";
import type { Secrets } from "./store.ts";

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const PARTY = "22222222-2222-4222-8222-222222222222";
const ENTRY = "55555555-5555-4555-8555-555555555555";
const LINE = "88888888-8888-4888-8888-888888888888";
const PHONE_A = "33333333-3333-4333-8333-333333333333";
const PHONE_B = "66666666-6666-4666-8666-666666666666";
const INTRUDER = "99999999-9999-4999-8999-999999999999";

const CODE_RINA = "KRSB-7QF2-M4XN";
const CODE_JOKO = "KRSB-C6WQ-3T8D";

/**
 * Kode yang bentuknya sah tapi tidak pernah diterbitkan. Satu-satunya yang
 * berubah adalah huruf terakhir, supaya plafon per-alamat diuji tanpa lebih
 * dulu menabrak plafon per-kode.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BOGUS = [...ALPHABET].map((symbol) => `KRSB-QQQQ-QQQ${symbol}`);

const secrets: Secrets = {
  async sha256Hex(input) {
    return createHash("sha256").update(input).digest("hex");
  },
  newToken() {
    return randomBytes(16).toString("hex");
  },
};

type Clock = { micros: number };

function makeDeps(
  store: MemoryStore,
  clock: Clock,
  options: {
    ip?: string;
    origins?: string;
    counters?: Counters;
    /** Alamat dibaca lewat fungsi ini supaya satu `deps` bisa berpindah alamat. */
    address?: () => string;
  } = {},
): Deps {
  return {
    store,
    secrets,
    env: { allowedOrigins: options.origins ?? "" },
    // Di Worker asli hitungan dibagi satu isolat; tes yang menguji plafon
    // per-kode harus memakai peta yang sama, bukan satu peta per alamat.
    counters: options.counters ?? new Map(),
    nowMicros: () => clock.micros,
    nowSeconds: () => Math.floor(clock.micros / 1_000_000),
    clientIp: options.address ?? (() => options.ip ?? "203.0.113.7"),
  };
}

function request(
  method: "GET" | "POST" | "OPTIONS",
  path: string,
  options: { body?: unknown; token?: string; origin?: string } = {},
): Request {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers["authorization"] = `Bearer ${options.token}`;
  if (options.origin !== undefined) headers["origin"] = options.origin;
  return new Request(`https://api.karsa.test${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function activate(
  deps: Deps,
  code: string,
  deviceId: string,
): Promise<string> {
  const response = await handle(
    request("POST", "/license/verify", { body: { code, device_id: deviceId } }),
    deps,
  );
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return (JSON.parse(text) as { token: string }).token;
}

function partyRow(id: string, name: string, deviceId: string): unknown {
  return {
    table: "party",
    id,
    values: {
      id,
      business_id: BUSINESS,
      name,
      phone: null,
      note: null,
      created_at: 1,
      updated_at: 2,
      deleted: 0,
      device_id: deviceId,
    },
  };
}

async function seedLicenses(store: MemoryStore): Promise<void> {
  // Dua slot, supaya "ponsel kedua memakan slot" teruji dan bukan lolos karena
  // nilai bawaan yang kebetulan sama dengan jumlah ponsel dalam tes.
  store.seedLicense({ codeHash: await secrets.sha256Hex(CODE_RINA), owner: "rina", maxDevices: 2 });
  store.seedLicense({ codeHash: await secrets.sha256Hex(CODE_JOKO), owner: "joko", maxDevices: 2 });
}

test("health tidak butuh apa pun", async () => {
  const deps = makeDeps(new MemoryStore(), { micros: 1 });
  const response = await handle(request("GET", "/health"), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "karsa-business" });
});

test("kode yang belum pernah diterbitkan ditolak tanpa menjelaskan", async () => {
  const store = new MemoryStore();
  const deps = makeDeps(store, { micros: 1_000 });
  const response = await handle(
    request("POST", "/license/verify", {
      body: { code: "KRSB-AAAA-AA3A", device_id: PHONE_A },
    }),
    deps,
  );
  assert.equal(response.status, 401);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { error: "invalid" });
  assert.ok(!text.includes("AAAA"), "jawaban mengulang kode yang dicoba");
});

test("kode dipakai apa adanya setelah dibersihkan", async () => {
  const store = new MemoryStore();
  await seedLicenses(store);
  const deps = makeDeps(store, { micros: 1_000 });
  const token = await activate(deps, "krsb 7qf2 m4xn", PHONE_A);
  assert.ok(token.length >= 16);
  const outcome = await handle(
    request("GET", "/sync/pull", { token }),
    deps,
  );
  assert.equal(outcome.status, 200);
});

test("menempatkan kode yang sama di ponsel kedua tidak memakan slot", async () => {
  const store = new MemoryStore();
  await seedLicenses(store);
  const deps = makeDeps(store, { micros: 1_000 });
  await activate(deps, CODE_RINA, PHONE_A);
  await activate(deps, CODE_RINA, PHONE_B);
  assert.equal(store.devices.length, 2);
  const third = await handle(
    request("POST", "/license/verify", {
      body: { code: CODE_RINA, device_id: INTRUDER },
    }),
    deps,
  );
  assert.equal(third.status, 403);
  assert.deepEqual(await third.json(), { error: "device_limit" });
  // Pemasangan ulang di ponsel yang sama tetap boleh, dan mematikan jalur lama.
  const again = await activate(deps, CODE_RINA, PHONE_A);
  assert.equal(store.devices.length, 2);
  const stale = await handle(request("GET", "/sync/pull", { token: again }), deps);
  assert.equal(stale.status, 200);
});

test("jalur tulis dan baca kunci pada satu pemilik", async () => {
  const store = new MemoryStore();
  await seedLicenses(store);
  const clock = { micros: 1_000 };
  const deps = makeDeps(store, clock);
  const token = await activate(deps, CODE_RINA, PHONE_A);

  const pushed = await handle(
    request("POST", "/sync/push", {
      token,
      body: { rows: [{ table: "business", id: BUSINESS, values: { id: BUSINESS, name: "Warung", created_at: 1, updated_at: 2, deleted: 0, device_id: PHONE_A } }, partyRow(PARTY, "Rina beli", PHONE_A)] },
    }),
    deps,
  );
  assert.equal(pushed.status, 200);
  assert.deepEqual(await pushed.json(), { accepted: 2, head: 2 });

  const page = await handle(request("GET", "/sync/pull", { token }), deps);
  const body = (await page.json()) as {
    rows: { table: string; id: string; rev: number; values: Record<string, unknown> }[];
    next_rev: number;
    has_more: boolean;
  };
  assert.equal(body.rows.length, 2);
  assert.deepEqual(body.rows.map((row) => row.table), ["business", "party"]);
  assert.equal(body.has_more, false);
  assert.equal(body.next_rev, 2);
  // Yang tersimpan memakai perangkat dari token, bukan dari badan minta.
  const party = body.rows.find((row) => row.table === "party");
  assert.equal(party?.values["device_id"], PHONE_A);
  assert.equal("owner_id" in (party?.values ?? {}), false);
  assert.equal("rev" in (party?.values ?? {}), false);
});

test("tanpa token tidak ada satu pun jalur data yang terbuka", async () => {
  const store = new MemoryStore();
  await seedLicenses(store);
  const deps = makeDeps(store, { micros: 1 });
  for (const [method, path] of [
    ["POST", "/sync/push"],
    ["GET", "/sync/pull"],
    ["GET", "/report/trial-balance"],
  ] as const) {
    const response = await handle(
      request(method, path, method === "POST" ? { body: { rows: [] } } : {}),
      deps,
    );
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.deepEqual(await response.json(), { error: "unauthorized" });
  }
  // Absen lebih dulu dari rute: tanpa token, jalur yang tidak ada pun menjawab
  // 401, sehingga pengintai tidak bisa memetakan permukaan API dengan menebak.
  assert.equal((await handle(request("GET", "/secrets"), deps)).status, 401);
  assert.deepEqual(await (await handle(request("POST", "/push"), deps)).json(), { error: "unauthorized" });
});

test("jalur yang tidak dikenal baru terlihat oleh yang sudah punya token", async () => {
  const store = new MemoryStore();
  await seedLicenses(store);
  const deps = makeDeps(store, { micros: 1 });
  const token = await activate(deps, CODE_RINA, PHONE_A);
  const response = await handle(request("GET", "/report/secrets-ku", { token }), deps);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
});

test("dua pemilik tidak bisa saling menimpa meski id-nya sama", async () => {
  const store = new MemoryStore();
  await seedLicenses(store);
  const clock = { micros: 1_000 };
  const deps = makeDeps(store, clock);
  const rina = await activate(deps, CODE_RINA, PHONE_A);
  const joko = await activate(deps, CODE_JOKO, PHONE_B);

  await handle(
    request("POST", "/sync/push", { token: rina, body: { rows: [partyRow(PARTY, "piutang Rina", PHONE_A)] } }),
    deps,
  );
  // Joko mengarang baris dengan id milik Rina, lengkap dengan tombstone.
  const attack = await handle(
    request("POST", "/sync/push", { token: joko, body: { rows: [partyRow(PARTY, "bukan punya Rina", PHONE_B)] } }),
    deps,
  );
  assert.equal(attack.status, 200);
  const tombstone = await handle(
    request("POST", "/sync/push", {
      token: joko,
      body: {
        rows: [
          {
            table: "party",
            id: PARTY,
            values: { id: PARTY, business_id: BUSINESS, name: "dihapus", created_at: 1, updated_at: 2, deleted: 1, device_id: PHONE_B },
          },
        ],
      },
    }),
    deps,
  );
  assert.equal(tombstone.status, 200);

  const mine = await handle(request("GET", "/sync/pull", { token: rina }), deps);
  const body = (await mine.json()) as { rows: { id: string; values: Record<string, unknown> }[] };
  assert.equal(body.rows.length, 1, "baris Rina bertambah");
  assert.equal(body.rows[0]?.values["name"], "piutang Rina");
  assert.equal(body.rows[0]?.values["deleted"], 0, "baris Rina tidak dihapus orang lain");

  const theirs = await handle(request("GET", "/sync/pull", { token: joko }), deps);
  const theirsBody = (await theirs.json()) as { rows: { id: string }[] };
  assert.deepEqual(theirsBody.rows.map((row) => row.id), [PARTY], "serangan mendarat di namespace Joko sendiri");
});

test("token mati bersamaan dengan lisensinya", async () => {
  const store = new MemoryStore();
  await seedLicenses(store);
  const deps = makeDeps(store, { micros: 1 });
  const token = await activate(deps, CODE_RINA, PHONE_A);
  store.revoke("rina");
  const response = await handle(request("GET", "/sync/pull", { token }), deps);
  assert.equal(response.status, 401);
});

test("halaman unduhan berhenti di limit dan mengakui masih ada", async () => {
  const store = new MemoryStore();
  await seedLicenses(store);
  const deps = makeDeps(store, { micros: 1 });
  const token = await activate(deps, CODE_RINA, PHONE_A);
  const ids = [PARTY, ENTRY, LINE];
  await handle(
    request("POST", "/sync/push", {
      token,
      body: { rows: ids.map((id, index) => partyRow(id, `piutang ${index}`, PHONE_A)) },
    }),
    deps,
  );
  const first = (await (await handle(request("GET", "/sync/pull?limit=2", { token }), deps)).json()) as {
    rows: unknown[];
    next_rev: number;
    has_more: boolean;
  };
  assert.equal(first.rows.length, 2);
  assert.equal(first.has_more, true);
  const rest = (await (
    await handle(request("GET", `/sync/pull?since_rev=${first.next_rev}&limit=2`, { token }), deps)
  ).json()) as { rows: { rev: number }[]; has_more: boolean };
  assert.equal(rest.rows.length, 1);
  assert.equal(rest.has_more, false);
  assert.ok(rest.rows[0]!.rev > first.next_rev, "kursor tidak pernah mundur");
});

test("sejarah yang sudah diringkas diakui sebagai 409", async () => {
  const store = new MemoryStore();
  await seedLicenses(store);
  const deps = makeDeps(store, { micros: 1 });
  const token = await activate(deps, CODE_RINA, PHONE_A);
  await handle(request("POST", "/sync/push", { token, body: { rows: [partyRow(PARTY, "Rina", PHONE_A)] } }), deps);
  store.setFloor("rina", 500);
  const response = await handle(request("GET", "/sync/pull?since_rev=1", { token }), deps);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "resync_required" });

  // Unduh ulang penuh adalah obat yang disarankan 409 itu. Kalau ia juga
  // ditolak, nasihatnya tidak bisa dijalankan dan perangkat macet selamanya.
  const fresh = await handle(request("GET", "/sync/pull", { token }), deps);
  assert.equal(fresh.status, 200);
  const body = (await fresh.json()) as { rows: unknown[] };
  assert.equal(body.rows.length, 1);
});

test("baris yang cacat membatalkan seluruh batch tanpa mengulang isinya", async () => {
  const store = new MemoryStore();
  await seedLicenses(store);
  const deps = makeDeps(store, { micros: 1 });
  const token = await activate(deps, CODE_RINA, PHONE_A);
  const response = await handle(
    request("POST", "/sync/push", {
      token,
      body: { rows: [partyRow(PARTY, "Rina", PHONE_A), { table: "rahasia_perusahaan", id: ENTRY, values: {} }] },
    }),
    deps,
  );
  assert.equal(response.status, 400);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { error: "unknown_table" });
  assert.ok(!text.includes("rahasia"), "kode kesalahan mengulang nama dari pengirim");
  assert.equal(store.rows.size, 0, "batch tidak boleh mendarat sebagian");
});

test("badan minta yang bukan JSON tidak dilempar ke runtime", async () => {
  const store = new MemoryStore();
  await seedLicenses(store);
  const deps = makeDeps(store, { micros: 1 });
  const token = await activate(deps, CODE_RINA, PHONE_A);
  const raw = new Request("https://api.karsa.test/sync/push", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: "bukan json",
  });
  const response = await handle(raw, deps);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "bad_json" });
});

test("plafon per alamat menahan mesin pencari kode", async () => {
  const store = new MemoryStore();
  await seedLicenses(store);
  const clock = { micros: 1_000_000 };
  const deps = makeDeps(store, clock);
  const ceiling = LIMITS.verify_per_ip.requests;
  for (let index = 0; index < ceiling; index++) {
    const attempt = await handle(
      request("POST", "/license/verify", { body: { code: BOGUS[index]!, device_id: PHONE_A } }),
      deps,
    );
    assert.equal(attempt.status, 401, `percobaan ${index} seharusnya masih dijawab salah`);
  }
  const blocked = await handle(
    request("POST", "/license/verify", { body: { code: BOGUS[ceiling]!, device_id: PHONE_A } }),
    deps,
  );
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  // Alamat lain tidak ikut dihukum, dan jendela yang lewat membebaskan yang ini.
  const elsewhere = makeDeps(store, clock, { ip: "198.51.100.4" });
  assert.equal(
    (await handle(request("POST", "/license/verify", { body: { code: CODE_RINA, device_id: PHONE_A } }), elsewhere)).status,
    200,
  );
  clock.micros += (LIMITS.verify_per_ip.seconds + 1) * 1_000_000;
  assert.equal(
    (await handle(request("POST", "/license/verify", { body: { code: CODE_JOKO, device_id: PHONE_A } }), deps)).status,
    200,
  );
});

test("satu kode yang dipindahtangankan habis jatahnya sendiri", async () => {
  const store = new MemoryStore();
  await seedLicenses(store);
  const clock = { micros: 1_000_000 };
  // Satu isolat, satu peta hitungan, alamat berganti-ganti. Yang dihabiskan di
  // sini adalah plafon per-kode (12) dan ia sengaja lebih ketat daripada plafon
  // per-alamat (20): satu kunci bocor tidak bisa dipakai serentak dari banyak
  // tempat tanpa masuk daftar tunggu.
  const counters: Counters = new Map();
  let address = "10.0.0.1";
  const deps = makeDeps(store, clock, { counters, address: () => address });
  for (let index = 0; index < LIMITS.verify_per_code.requests; index++) {
    address = `10.0.0.${index + 1}`;
    const attempt = await handle(
      request("POST", "/license/verify", { body: { code: CODE_RINA, device_id: PHONE_A } }),
      deps,
    );
    assert.equal(attempt.status, 200, `aktivasi ${index} masih dalam jatah`);
  }
  address = "10.0.9.9";
  const blocked = await handle(
    request("POST", "/license/verify", { body: { code: CODE_RINA, device_id: PHONE_A } }),
    deps,
  );
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), { error: "slow_down" });
  // Kode lain dari alamat yang sama tetap boleh: yang habis kodenya, bukan alamatnya.
  assert.equal(
    (await handle(request("POST", "/license/verify", { body: { code: CODE_JOKO, device_id: PHONE_B } }), deps)).status,
    200,
  );
});

test("kesalahan dari dalam dicatat, tidak dikirim", async (t) => {
  const store = new MemoryStore();
  await seedLicenses(store);
  const deps = makeDeps(store, { micros: 1 });
  const token = await activate(deps, CODE_RINA, PHONE_A);
  store.rowsSince = () => {
    throw new TypeError("ssl_verify=full gagal ke endpoint neon");
  };

  const logged: unknown[] = [];
  // `t.mock` mengembalikan `console.error` sendiri sesudah tes, jadi yang
  // ditumpuk di sini cuma satu baris dan tidak bocor ke tes berikutnya.
  t.mock.method(console, "error", (entry: unknown) => {
    logged.push(entry);
  });

  const response = await handle(request("GET", "/sync/pull", { token }), deps);
  assert.equal(response.status, 500);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { error: "internal" });
  assert.ok(!text.includes("neon"), "kalimat kesalahan dalam ikut keluar ke pengirim");
  assert.equal(logged.length, 1, "kesalahan dalam harus tetap tercatat di log isolat");
  assert.ok(String(logged[0]).includes("neon"), "yang tercatat bukan kesalahan yang benar");
});

test("peranti asal hanya echo untuk yang terdaftar", async () => {
  const store = new MemoryStore();
  const deps = makeDeps(store, { micros: 1 }, { origins: "https://karsa.vercel.app" });
  const allowed = await handle(request("OPTIONS", "/sync/push", { origin: "https://karsa.vercel.app" }), deps);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://karsa.vercel.app");
  const refused = await handle(request("GET", "/health", { origin: "https://lain.example" }), deps);
  assert.equal(refused.headers.get("access-control-allow-origin"), null);
  const noConfig = await handle(
    request("GET", "/health", { origin: "https://karsa.vercel.app" }),
    makeDeps(store, { micros: 1 }),
  );
  assert.equal(noConfig.headers.get("access-control-allow-origin"), null);
});

test("laporan hanya berisi usaha milik pemilik token", async () => {
  const store = new MemoryStore();
  await seedLicenses(store);
  const deps = makeDeps(store, { micros: 1 });
  const token = await activate(deps, CODE_RINA, PHONE_A);
  const listed = await handle(request("GET", "/report/trial-balance", { token }), deps);
  assert.deepEqual(await listed.json(), { businesses: [] });
  await handle(
    request("POST", "/sync/push", {
      token,
      body: {
        rows: [
          { table: "business", id: BUSINESS, values: { id: BUSINESS, name: "Warung", created_at: 1, updated_at: 2, deleted: 0, device_id: PHONE_A } },
          { table: "ledger_line", id: LINE, values: { id: LINE, entry_id: ENTRY, business_id: BUSINESS, account_code: "1100", debit: 300_000, credit: 0, created_at: 1, updated_at: 2, deleted: 0, device_id: PHONE_A } },
          { table: "ledger_line", id: PARTY, values: { id: PARTY, entry_id: ENTRY, business_id: BUSINESS, account_code: "3100", debit: 0, credit: 300_000, created_at: 1, updated_at: 2, deleted: 0, device_id: PHONE_A } },
        ],
      },
    }),
    deps,
  );
  const owned = (await (await handle(request("GET", "/report/trial-balance", { token }), deps)).json()) as {
    businesses: { id: string; name: string }[];
  };
  assert.deepEqual(owned.businesses, [{ id: BUSINESS, name: "Warung" }]);
  const balance = (await (
    await handle(request("GET", `/report/trial-balance?business_id=${BUSINESS}`, { token }), deps)
  ).json()) as { balanced: boolean; rows: { account_code: string; debit: number; credit: number }[] };
  assert.equal(balance.balanced, true);
  assert.deepEqual(balance.rows, [
    { account_code: "1100", name: "", debit: 300_000, credit: 0 },
    { account_code: "3100", name: "", debit: 0, credit: 300_000 },
  ]);
  const joko = await activate(deps, CODE_JOKO, PHONE_B);
  const empty = (await (
    await handle(request("GET", `/report/trial-balance?business_id=${BUSINESS}`, { token: joko }), deps)
  ).json()) as { rows: unknown[] };
  assert.deepEqual(empty.rows, [], "usaha orang lain tidak terbaca lewat tebak id");
});

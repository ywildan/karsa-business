import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { createApi, identityFrom } from "../functions/api-app.js";
import { applyMigrations } from "../scripts/migrate.js";
if (!process.env.TEST_DATABASE_URL)
  throw new Error("Disposable TEST_DATABASE_URL required");
const schema = `test_${randomUUID().replaceAll("-", "")}`;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const app = createApi(pool, async (uid) => {
  if (uid === "invalid") throw new Error();
  return { uid, email: `${uid}@students.untidar.ac.id`, name: uid };
});
const now = 1700000000000;
const business = () => ({
  id: randomUUID() as string,
  name: "Usaha mahasiswa",
  type: "Toko",
  initialCapital: 1000,
  createdAt: now,
  updatedAt: now,
});
const product = (businessId: string) => ({
  id: randomUUID(),
  businessId,
  name: "Produk",
  price: 100,
  stock: 50,
  createdAt: now,
  updatedAt: now,
  deletedAt: null as number | null,
});
const transaction = (businessId: string, productId: string | null = null) => ({
  id: randomUUID(),
  businessId,
  type: "INCOME",
  amount: 100,
  category: "Penjualan",
  paymentMethod: "Tunai",
  note: "",
  transactionDate: now,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  productId,
  quantity: productId ? 1 : null,
});
const sync = (
  uid: string,
  b: ReturnType<typeof business>,
  products: unknown[] = [],
  transactions: unknown[] = [],
) =>
  app.request("/v1/sync", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${uid}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ business: b, products, transactions }),
  });
const snapshot = (uid: string) =>
  app.request("/v1/snapshot", { headers: { Authorization: `Bearer ${uid}` } });
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await applyMigrations(pool);
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
test("all migrations applied and repeated without data loss", async () => {
  assert.equal((await sync("migration", business())).status, 200);
  await applyMigrations(pool);
  assert.equal(
    (await pool.query("SELECT * FROM schema_migrations")).rowCount,
    2,
  );
  assert.equal((await snapshot("migration")).status, 200);
});
test("authentication and verified campus identity required", async () => {
  assert.equal((await app.request("/v1/snapshot")).status, 401);
  assert.equal((await snapshot("invalid")).status, 401);
  assert.throws(() =>
    identityFrom({ sub: "u", email: "u@example.com", email_verified: true }),
  );
  assert.throws(() =>
    identityFrom({
      sub: "u",
      email: "u@students.untidar.ac.id",
      email_verified: false,
    }),
  );
});
test("bad JSON and validation errors return 400", async () => {
  for (const body of [
    "{",
    "null",
    "{}",
    JSON.stringify({ business: business(), transactions: [null] }),
  ]) {
    assert.equal(
      (
        await app.request("/v1/sync", {
          method: "POST",
          headers: { Authorization: "Bearer validation" },
          body,
        })
      ).status,
      400,
      body,
    );
  }
});
test("501 items rejected before writes", async () => {
  const b = business();
  assert.equal(
    (
      await sync(
        "limit",
        b,
        [],
        Array.from({ length: 501 }, () => transaction(b.id)),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await sync(
        "limit",
        b,
        Array.from({ length: 501 }, () => product(b.id)),
      )
    ).status,
    400,
  );
  assert.equal(
    (await pool.query("SELECT * FROM businesses WHERE owner_id=$1", ["limit"]))
      .rowCount,
    0,
  );
});
test("1001 transactions batched and retry idempotent", async () => {
  const b = business(),
    rows = Array.from({ length: 1001 }, () => transaction(b.id));
  for (let i = 0; i < rows.length; i += 400)
    assert.equal(
      (await sync("batches", b, [], rows.slice(i, i + 400))).status,
      200,
    );
  assert.equal((await sync("batches", b, [], rows.slice(0, 400))).status, 200);
  assert.equal(
    (await (await snapshot("batches")).json()).transactions.length,
    1001,
  );
});
test("product tombstones returned and historical sales accepted", async () => {
  const b = business(),
    p = product(b.id);
  assert.equal(
    (await sync("deletion", b, [p], [transaction(b.id, p.id)])).status,
    200,
  );
  p.deletedAt = now + 1;
  p.updatedAt = now + 1;
  assert.equal(
    (await (await sync("deletion", b, [p])).json()).products[0].deletedAt,
    now + 1,
  );
  assert.equal(
    (await sync("deletion", b, [], [transaction(b.id, p.id)])).status,
    200,
  );
  const result = await (await snapshot("deletion")).json();
  assert.equal(result.products[0].deletedAt, now + 1);
  assert.equal(result.transactions.length, 2);
});
test("second offline business adopts canonical ID for all items", async () => {
  const first = business(),
    second = business(),
    p = product(second.id);
  assert.equal((await sync("canonical", first)).status, 200);
  const response = await sync(
    "canonical",
    second,
    [p],
    [transaction(second.id, p.id)],
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.business.id, first.id);
  assert.equal(result.products[0].businessId, first.id);
  assert.equal(result.transactions[0].businessId, first.id);
});
test("foreign links and record IDs rejected without cross-owner changes", async () => {
  const a = business(),
    b = business(),
    p = product(a.id);
  assert.equal((await sync("ownerA", a, [p])).status, 200);
  assert.equal(
    (await sync("ownerB", b, [], [transaction(b.id, p.id)])).status,
    400,
  );
  assert.equal(
    (await sync("ownerB", b, [{ ...p, businessId: b.id }])).status,
    400,
  );
  assert.equal((await (await snapshot("ownerA")).json()).products[0].stock, 50);
  assert.equal((await (await snapshot("ownerB")).json()).products.length, 0);
});
test("malformed identifiers and mismatched business rejected", async () => {
  const b = business();
  assert.equal(
    (await sync("mismatch", b, [product(randomUUID())])).status,
    400,
  );
  assert.equal((await sync("mismatch", { ...b, id: "bad" })).status, 400);
});
test("newer server values survive stale retries", async () => {
  const b = business(),
    p = product(b.id);
  assert.equal((await sync("stale", b, [p])).status, 200);
  assert.equal(
    (
      await sync("stale", { ...b, name: "Nama terbaru", updatedAt: now + 2 }, [
        { ...p, stock: 20, updatedAt: now + 2 },
      ])
    ).status,
    200,
  );
  const result = await (await sync("stale", b, [p])).json();
  assert.equal(result.business.name, "Nama terbaru");
  assert.equal(result.products[0].stock, 20);
});
test("database outages return retryable 503, not auth error", async () => {
  const unavailable = createApi(
    {
      connect: async () => {
        throw new Error("unavailable");
      },
    } as unknown as Pool,
    async () => ({ uid: "u", email: "u@students.untidar.ac.id", name: "u" }),
  );
  assert.equal(
    (
      await unavailable.request("/v1/snapshot", {
        headers: { Authorization: "Bearer u" },
      })
    ).status,
    503,
  );
});

test("changed applied migration rejected while existing data survives", async () => {
  await pool.query(
    "UPDATE schema_migrations SET checksum='invalid' WHERE filename='002_products.sql'",
  );
  await assert.rejects(applyMigrations(pool), /Applied migration changed/);
  assert.equal((await snapshot("migration")).status, 200);
});

test("offline stock edits cannot resurrect a deleted catalog product", async () => {
  const b = business(),
    p = product(b.id);
  assert.equal((await sync("deleted-conflict", b, [p])).status, 200);
  assert.equal(
    (
      await sync("deleted-conflict", b, [
        { ...p, deletedAt: now + 1, updatedAt: now + 1 },
      ])
    ).status,
    200,
  );
  const response = await sync(
    "deleted-conflict",
    b,
    [{ ...p, stock: 49, updatedAt: now + 2 }],
    [transaction(b.id, p.id)],
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.products[0].deletedAt, now + 1);
  assert.equal(result.products[0].updatedAt, now + 2);
  assert.equal(result.transactions.length, 1);

  const second = business(),
    item = product(second.id);
  assert.equal(
    (
      await sync("delete-after-edit", second, [
        { ...item, stock: 49, updatedAt: now + 2 },
      ])
    ).status,
    200,
  );
  const reverse = await sync("delete-after-edit", second, [
    { ...item, deletedAt: now + 1, updatedAt: now + 1 },
  ]);
  assert.equal(reverse.status, 200);
  const reverseResult = await reverse.json();
  assert.equal(reverseResult.products[0].deletedAt, now + 1);
  assert.equal(reverseResult.products[0].stock, 49);
  assert.equal(reverseResult.products[0].updatedAt, now + 2);
});

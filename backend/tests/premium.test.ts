import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { createApi } from "../functions/api-app.js";
import { applyMigrations } from "../scripts/migrate.js";
if (!process.env.TEST_DATABASE_URL)
    throw new Error("Disposable TEST_DATABASE_URL required");
const schema = `premium_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
const app = createApi(pool, async (uid) => ({ uid, email: `${uid}@students.untidar.ac.id`, name: uid }));
const request = (uid: string, path: string, method = 'GET', body?: unknown) => app.request(path, { method, headers: { Authorization: `Bearer ${uid}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const makeBusiness = (uid: string, name = 'Usaha') => request(uid, '/v2/businesses', 'POST', { name, type: 'Toko', initialCapital: 1000 });
async function premium(uid: string) { await request(uid, '/v2/account'); await pool.query("UPDATE app_users SET premium_until=now()+interval '30 days' WHERE firebase_uid=$1", [uid]); }
const snapshot = (uid: string) => request(uid, '/v2/snapshot');
before(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await applyMigrations(pool); });
after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
test('free account has one business, cannot access web, cannot grant itself Premium', async () => {
    assert.equal((await makeBusiness('free')).status, 200);
    const forged = await request('free', '/v2/businesses', 'POST', { name: 'Bisnis kedua', initialCapital: 0, premium: true, premiumUntil: 9999999999999 });
    assert.equal(forged.status, 403);
    assert.equal((await forged.json()).code, 'BUSINESS_LIMIT');
    assert.equal((await request('free', '/v2/web/snapshot')).status, 403);
    const result = await (await snapshot('free')).json();
    assert.equal(result.account.businessLimit, 1);
    assert.equal(result.businesses.length, 1);
    assert.equal((await app.request('/v2/web/snapshot')).status, 401);
});
test('concurrent Premium creation cannot exceed five businesses', async () => {
    await premium('limits');
    const results = await Promise.all(Array.from({ length: 7 }, (_, i) => makeBusiness('limits', `Bisnis ${i}`)));
    assert.equal(results.filter(r => r.status === 200).length, 5);
    assert.equal(results.filter(r => r.status === 403).length, 2);
    assert.equal((await (await snapshot('limits')).json()).businesses.length, 5);
});
test('v2 sync isolates both owner and business while v1 only returns the original business', async () => {
    await premium('owner');
    const a = (await (await makeBusiness('owner', 'Bisnis A')).json()).business;
    const b = (await (await makeBusiness('owner', 'Bisnis B')).json()).business;
    const foreign = (await (await makeBusiness('foreign')).json()).business;
    const tx = { id: randomUUID(), businessId: a.id, type: 'INCOME', amount: 100, category: 'Penjualan', paymentMethod: 'Tunai', note: '', transactionDate: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null, productId: null, quantity: null };
    assert.equal((await request('owner', '/v2/sync', 'POST', { business: a, products: [], transactions: [tx] })).status, 200);
    assert.equal((await request('owner', '/v2/sync', 'POST', { business: b, products: [], transactions: [{ ...tx, businessId: b.id, updatedAt: tx.updatedAt + 1 }] })).status, 400);
    assert.equal((await request('owner', '/v2/sync', 'POST', { business: foreign, products: [], transactions: [] })).status, 403);
    const old = await (await request('owner', '/v1/snapshot')).json();
    assert.equal(old.business.id, a.id);
    assert.equal(old.transactions.length, 1);
    assert.equal(old.transactions[0].businessId, a.id);
    assert.equal((await (await snapshot('foreign')).json()).transactions.length, 0);
});
test('web sale updates stock atomically, rejects stale edits, preserves tombstones and refunds once', async () => {
    await premium('sales');
    const b = (await (await makeBusiness('sales')).json()).business;
    const productsPath = `/v2/web/businesses/${b.id}/products`, salesPath = `/v2/web/businesses/${b.id}/transactions`;
    const productResponse = await request('sales', productsPath, 'POST', { name: 'Kopi', price: 5000, stock: 10 });
    assert.equal(productResponse.status, 200);
    let p = (await productResponse.json()).products[0];
    let response = await request('sales', salesPath, 'POST', { type: 'INCOME', amount: 1, category: 'Penjualan', paymentMethod: 'Tunai', note: '', transactionDate: Date.now(), productId: p.id, quantity: 3 });
    assert.equal(response.status, 200);
    let result = await response.json(), tx = result.transactions[0];
    assert.equal(tx.amount, 15000);
    assert.equal(result.products[0].stock, 7);
    response = await request('sales', productsPath, 'POST', { id: p.id, name: 'Kopi', price: 5000, stock: 999, expectedUpdatedAt: p.updatedAt });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'STALE_RECORD');
    const deleted = await request('sales', `${salesPath}/${tx.id}`, 'DELETE', { expectedUpdatedAt: tx.updatedAt });
    assert.equal(deleted.status, 200);
    result = await deleted.json();
    assert.equal(result.products[0].stock, 10);
    assert.ok(result.transactions[0].deletedAt);
    assert.equal((await request('sales', `${salesPath}/${tx.id}`, 'DELETE', { expectedUpdatedAt: tx.updatedAt })).status, 200);
    assert.equal((await (await snapshot('sales')).json()).products[0].stock, 10);
    p = result.products[0];
    assert.equal((await request('sales', `${productsPath}/${p.id}`, 'DELETE', { expectedUpdatedAt: p.updatedAt })).status, 200);
    assert.ok((await (await snapshot('sales')).json()).products[0].deletedAt);
});
test('product links from another business cannot affect its stock', async () => {
    await premium('links');
    const a = (await (await makeBusiness('links', 'Bisnis A')).json()).business, b = (await (await makeBusiness('links', 'Bisnis B')).json()).business;
    const p = (await (await request('links', `/v2/web/businesses/${a.id}/products`, 'POST', { name: 'Produk', price: 100, stock: 5 })).json()).products[0];
    const response = await request('links', `/v2/web/businesses/${b.id}/transactions`, 'POST', { type: 'INCOME', amount: 100, category: 'Penjualan', paymentMethod: 'Tunai', note: '', transactionDate: Date.now(), productId: p.id, quantity: 1 });
    assert.equal(response.status, 400);
    assert.equal((await (await snapshot('links')).json()).products[0].stock, 5);
});
test('expired Premium preserves data, locks web and other businesses, allows choosing the free business', async () => {
    await premium('expiry');
    const a = (await (await makeBusiness('expiry', 'Bisnis A')).json()).business, b = (await (await makeBusiness('expiry', 'Bisnis B')).json()).business;
    await pool.query("UPDATE app_users SET premium_until=now()-interval '1 second' WHERE firebase_uid='expiry'");
    assert.equal((await request('expiry', '/v2/web/snapshot')).status, 403);
    assert.equal((await request('expiry', '/v2/sync', 'POST', { business: b, products: [], transactions: [] })).status, 403);
    assert.equal((await request('expiry', '/v2/sync', 'POST', { business: a, products: [], transactions: [] })).status, 200);
    assert.equal((await (await snapshot('expiry')).json()).businesses.length, 2);
    assert.equal((await request('expiry', '/v2/account/free-business', 'PUT', { businessId: b.id })).status, 200);
    assert.equal((await request('expiry', '/v2/sync', 'POST', { business: b, products: [], transactions: [] })).status, 200);
    const other = (await (await makeBusiness('other')).json()).business;
    assert.equal((await request('expiry', '/v2/account/free-business', 'PUT', { businessId: other.id })).status, 400);
});
test('editing businesses uses ownership and version checks', async () => {
    await premium('settings');
    const b = (await (await makeBusiness('settings')).json()).business;
    let response = await request('settings', `/v2/businesses/${b.id}`, 'PUT', { name: 'Nama baru', type: 'Jasa', initialCapital: 2000, expectedUpdatedAt: b.updatedAt });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).businesses[0].name, 'Nama baru');
    assert.equal((await request('settings', `/v2/businesses/${b.id}`, 'PUT', { name: 'Usang', initialCapital: 0, expectedUpdatedAt: b.updatedAt })).status, 409);
    assert.equal((await request('other', `/v2/businesses/${b.id}`, 'PUT', { name: 'Curian', initialCapital: 0, expectedUpdatedAt: b.updatedAt })).status, 403);
});

test("migration keeps original IDs, transactions and default business for old clients", async () => {
    const legacySchema = `${schema}_legacy`;
    await admin.query(`CREATE SCHEMA ${legacySchema}`);
    const legacy = new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${legacySchema}`});
    try {
        for (const file of ["001_initial.sql", "002_products.sql"]) await legacy.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
        const businessId = randomUUID(), txId = randomUUID();
        await legacy.query("INSERT INTO app_users(firebase_uid,email) VALUES('old-user','old-user@students.untidar.ac.id')");
        await legacy.query("INSERT INTO businesses(id,owner_id,name,type,created_at,updated_at) VALUES($1,'old-user','Usaha lama','Toko',now(),now())",[businessId]);
        await legacy.query("INSERT INTO transactions(id,business_id,owner_id,type,amount,category,payment_method,transaction_date,created_at,updated_at) VALUES($1,$2,'old-user','INCOME',95000,'Penjualan','Tunai',now(),now(),now())",[txId,businessId]);
        await applyMigrations(legacy);
        assert.equal((await legacy.query("SELECT id FROM businesses")).rows[0].id,businessId);
        assert.equal((await legacy.query("SELECT id,business_id FROM transactions")).rows[0].id,txId);
        assert.equal((await legacy.query("SELECT free_business_id,legacy_business_id FROM app_users")).rows[0].legacy_business_id,businessId);
        await applyMigrations(legacy);
        assert.equal((await legacy.query("SELECT count(*) FROM transactions")).rows[0].count,'1');
    } finally { await legacy.end();await admin.query(`DROP SCHEMA ${legacySchema} CASCADE`); }
});

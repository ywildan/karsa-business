import { randomUUID } from "node:crypto";
import type { Hono, Context } from "hono";
import type { Pool, PoolClient } from "pg";
import type { Variables } from "./api-app.js";
import { InputError, requireUuid, requireBusiness, requireProducts, requireTransactions, upsertIdentity, writeBusiness, upsertProduct, upsertTransaction, toApiBusiness, toApiProduct, toApiTransaction } from "./records.js";
type App = Hono<{
    Variables: Variables;
}>;
type Ctx = Context<{
    Variables: Variables;
}>;
class AccessError extends Error {
    constructor(public code: string, message: string, public status: 403 | 409 = 403) { super(message); }
}
export async function account(client: PoolClient, uid: string, lock = false) {
    const user = (await client.query(`SELECT premium_until, free_business_id, legacy_business_id,
    COALESCE(premium_until > now(), false) AS premium FROM app_users WHERE firebase_uid=$1 ${lock ? "FOR UPDATE" : ""}`, [uid])).rows[0];
    return { premium: Boolean(user?.premium), premiumUntil: user?.premium_until?.getTime() ?? null,
        businessLimit: user?.premium ? 5 : 1, freeBusinessId: user?.free_business_id ?? null, legacyBusinessId: user?.legacy_business_id ?? null };
}
async function snapshot(client: PoolClient, uid: string) {
    const businesses = await client.query("SELECT * FROM businesses WHERE owner_id=$1 ORDER BY created_at,id", [uid]);
    const products = await client.query("SELECT * FROM products WHERE owner_id=$1 ORDER BY name,id", [uid]);
    const transactions = await client.query("SELECT * FROM transactions WHERE owner_id=$1 ORDER BY transaction_date DESC,id", [uid]);
    return { account: await account(client, uid), businesses: businesses.rows.map(toApiBusiness),
        products: products.rows.map(toApiProduct), transactions: transactions.rows.map(toApiTransaction) };
}
async function body(c: Ctx): Promise<Record<string, unknown>> {
    try {
        const value = await c.req.json();
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error();
        return value;
    }
    catch {
        throw new InputError("Isi permintaan tidak valid");
    }
}
function premiumRequired(plan: Awaited<ReturnType<typeof account>>) {
    if (!plan.premium)
        throw new AccessError("PREMIUM_REQUIRED", "Dashboard web tersedia untuk akun Premium.");
}
async function writable(client: PoolClient, uid: string, id: string, plan: Awaited<ReturnType<typeof account>>) {
    const row = (await client.query("SELECT * FROM businesses WHERE id=$1 AND owner_id=$2", [id, uid])).rows[0];
    if (!row)
        throw new AccessError("BUSINESS_NOT_FOUND", "Bisnis tidak ditemukan.");
    if (!plan.premium && plan.freeBusinessId !== id)
        throw new AccessError("BUSINESS_READ_ONLY", "Premium berakhir. Bisnis ini hanya dapat dibaca; pilih sebagai bisnis gratis untuk melanjutkan.");
    return row;
}
async function createBusiness(client: PoolClient, uid: string, input: unknown, plan: Awaited<ReturnType<typeof account>>) {
    const b = requireBusiness(input);
    const count = Number((await client.query("SELECT count(*) FROM businesses WHERE owner_id=$1", [uid])).rows[0].count);
    if (count >= plan.businessLimit)
        throw new AccessError("BUSINESS_LIMIT", `Paket ini mengizinkan maksimal ${plan.businessLimit} bisnis.`);
    await writeBusiness(client, uid, b);
    await client.query("UPDATE app_users SET free_business_id=COALESCE(free_business_id,$2::uuid),legacy_business_id=COALESCE(legacy_business_id,$2::uuid) WHERE firebase_uid=$1", [uid, b.id]);
    return b;
}
function expected(row: Record<string, unknown>, value: unknown) {
    const updated = (row.updated_at as Date).getTime();
    if (!Number.isSafeInteger(value) || updated !== value)
        throw new AccessError("STALE_RECORD", "Data berubah di perangkat lain. Muat ulang sebelum menyimpan.", 409);
}
function nowAfter(...rows: (Record<string, unknown> | undefined)[]) {
    return Math.max(Date.now(), ...rows.map(r => r ? (r.updated_at as Date).getTime() + 1 : 0));
}
export function registerPremiumApi(app: App, pool: Pool) {
    // Serialize limits and web writes for the account, including concurrent requests.
    const withClient = (operation: (c: Ctx, client: PoolClient, uid: string, plan: Awaited<ReturnType<typeof account>>) => Promise<unknown>) => async (c: Ctx) => {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const identity = c.get("identity");
            await upsertIdentity(client, identity);
            const plan = await account(client, identity.uid, true);
            const result = await operation(c, client, identity.uid, plan);
            await client.query("COMMIT");
            return c.json(result as Record<string, unknown>);
        }
        catch (error) {
            await client.query("ROLLBACK");
            if (error instanceof AccessError)
                return c.json({ error: error.message, code: error.code }, error.status);
            if ((error as {
                code?: string;
            }).code === "23505")
                return c.json({ error: "Identifier already used", code: "DATA_CONFLICT" }, 409);
            throw error;
        }
        finally {
            client.release();
        }
    };
    app.get("/v2/account", withClient(async (_, client, uid, plan) => ({ account: plan, businesses: (await snapshot(client, uid)).businesses })));
    app.get("/v2/snapshot", withClient(async (_, client, uid) => snapshot(client, uid)));
    app.get("/v2/web/snapshot", withClient(async (_, client, uid, plan) => { premiumRequired(plan); return snapshot(client, uid); }));
    app.put("/v2/account/free-business", withClient(async (c, client, uid) => {
        const id = requireUuid((await body(c)).businessId);
        if (!(await client.query("SELECT id FROM businesses WHERE id=$1 AND owner_id=$2", [id, uid])).rowCount)
            throw new InputError("Bisnis tidak ditemukan");
        await client.query("UPDATE app_users SET free_business_id=$2 WHERE firebase_uid=$1", [uid, id]);
        return { account: await account(client, uid) };
    }));
    app.post("/v2/businesses", withClient(async (c, client, uid, plan) => {
        const input = await body(c);
        const now = Date.now();
        const b = await createBusiness(client, uid, { ...input, id: randomUUID(), createdAt: now, updatedAt: now }, plan);
        return { business: toApiBusiness((await client.query("SELECT * FROM businesses WHERE id=$1", [b.id])).rows[0]), account: await account(client, uid) };
    }));
    app.put("/v2/businesses/:businessId", withClient(async (c, client, uid, plan) => {
        const id = requireUuid(c.req.param("businessId"));
        const row = await writable(client, uid, id, plan);
        const input = await body(c);
        expected(row, input.expectedUpdatedAt);
        await writeBusiness(client, uid, requireBusiness({ ...input, id, createdAt: (row.created_at as Date).getTime(), updatedAt: nowAfter(row) }));
        return snapshot(client, uid);
    }));
    app.post("/v2/sync", withClient(async (c, client, uid, plan) => {
        const input = await body(c), b = requireBusiness(input.business), products = requireProducts(input.products ?? []), transactions = requireTransactions(input.transactions);
        if ([...products, ...transactions].some(r => r.businessId !== b.id))
            throw new InputError("Items must belong to the submitted business");
        const exists = (await client.query("SELECT owner_id FROM businesses WHERE id=$1", [b.id])).rows[0];
        if (exists) {
            await writable(client, uid, b.id, plan);
            await writeBusiness(client, uid, b);
        }
        else
            await createBusiness(client, uid, b, plan);
        for (const p of products)
            await upsertProduct(client, uid, b.id, p);
        const ids = new Set((await client.query("SELECT id FROM products WHERE owner_id=$1 AND business_id=$2", [uid, b.id])).rows.map(r => r.id));
        for (const tx of transactions) {
            if (tx.productId && !ids.has(tx.productId))
                throw new InputError("Unknown product");
            await upsertTransaction(client, uid, b.id, tx);
        }
        return snapshot(client, uid);
    }));
    app.post("/v2/web/businesses/:businessId/products", withClient(async (c, client, uid, plan) => {
        premiumRequired(plan);
        const businessId = requireUuid(c.req.param("businessId"));
        await writable(client, uid, businessId, plan);
        const input = await body(c), id = input.id == null ? randomUUID() : requireUuid(input.id);
        const row = (await client.query("SELECT * FROM products WHERE id=$1 AND owner_id=$2 AND business_id=$3 FOR UPDATE", [id, uid, businessId])).rows[0];
        if (input.id != null && !row)
            throw new InputError("Produk tidak ditemukan");
        if (row) {
            if (row.deleted_at)
                throw new InputError("Produk sudah dihapus");
            expected(row, input.expectedUpdatedAt);
        }
        const now = nowAfter(row);
        const [p] = requireProducts([{ ...input, id, businessId, createdAt: row?.created_at?.getTime() ?? now, updatedAt: now, deletedAt: null }]);
        await upsertProduct(client, uid, businessId, p);
        return snapshot(client, uid);
    }));
    app.delete("/v2/web/businesses/:businessId/products/:id", withClient(async (c, client, uid, plan) => {
        premiumRequired(plan);
        const businessId = requireUuid(c.req.param("businessId"));
        await writable(client, uid, businessId, plan);
        const id = requireUuid(c.req.param("id")), input = await body(c);
        const row = (await client.query("SELECT * FROM products WHERE id=$1 AND owner_id=$2 AND business_id=$3 FOR UPDATE", [id, uid, businessId])).rows[0];
        if (!row)
            throw new InputError("Produk tidak ditemukan");
        if (!row.deleted_at) {
            expected(row, input.expectedUpdatedAt);
            const now = nowAfter(row);
            await client.query("UPDATE products SET deleted_at=to_timestamp($2/1000.0),updated_at=to_timestamp($2/1000.0) WHERE id=$1", [id, now]);
        }
        return snapshot(client, uid);
    }));
    app.post("/v2/web/businesses/:businessId/transactions", withClient(async (c, client, uid, plan) => {
        premiumRequired(plan);
        const businessId = requireUuid(c.req.param("businessId"));
        await writable(client, uid, businessId, plan);
        const input = await body(c), id = input.id == null ? randomUUID() : requireUuid(input.id);
        const old = (await client.query("SELECT * FROM transactions WHERE id=$1 AND owner_id=$2 AND business_id=$3 FOR UPDATE", [id, uid, businessId])).rows[0];
        if (input.id != null && !old)
            throw new InputError("Transaksi tidak ditemukan");
        if (old) {
            if (old.deleted_at)
                throw new InputError("Transaksi sudah dihapus");
            expected(old, input.expectedUpdatedAt);
        }
        const now = nowAfter(old);
        const [tx] = requireTransactions([{ ...input, id, businessId, createdAt: old?.created_at?.getTime() ?? now, updatedAt: now, deletedAt: null }]);
        const ids = [old?.product_id, tx.productId].filter(Boolean);
        const stocks = (await client.query("SELECT * FROM products WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND business_id=$3 ORDER BY id FOR UPDATE", [ids, uid, businessId])).rows;
        const amounts = new Map<string, number>(stocks.map(p => [p.id, Number(p.stock)]));
        if (old?.product_id)
            amounts.set(old.product_id, (amounts.get(old.product_id) ?? 0) + Number(old.quantity));
        if (tx.productId) {
            const p = stocks.find(p => p.id === tx.productId);
            if (!p || p.deleted_at)
                throw new InputError("Produk tidak tersedia");
            const stock = (amounts.get(tx.productId) ?? 0) - (tx.quantity ?? 0);
            if (stock < 0)
                throw new InputError("Stok produk tidak mencukupi");
            amounts.set(tx.productId, stock);
            tx.amount = Number(p.price) * (tx.quantity ?? 0);
            if (!Number.isSafeInteger(tx.amount) || tx.amount <= 0)
                throw new InputError("Nominal produk tidak valid");
        }
        for (const p of stocks) {
            const stock = amounts.get(p.id)!;
            if (!Number.isSafeInteger(stock))
                throw new InputError("Stok di luar batas");
            await client.query("UPDATE products SET stock=$2,updated_at=to_timestamp($3/1000.0) WHERE id=$1", [p.id, stock, Math.max(now, (p.updated_at as Date).getTime() + 1)]);
        }
        await upsertTransaction(client, uid, businessId, tx);
        return snapshot(client, uid);
    }));
    app.delete("/v2/web/businesses/:businessId/transactions/:id", withClient(async (c, client, uid, plan) => {
        premiumRequired(plan);
        const businessId = requireUuid(c.req.param("businessId"));
        await writable(client, uid, businessId, plan);
        const id = requireUuid(c.req.param("id")), input = await body(c);
        const tx = (await client.query("SELECT * FROM transactions WHERE id=$1 AND owner_id=$2 AND business_id=$3 FOR UPDATE", [id, uid, businessId])).rows[0];
        if (!tx)
            throw new InputError("Transaksi tidak ditemukan");
        if (!tx.deleted_at) {
            expected(tx, input.expectedUpdatedAt);
            const now = nowAfter(tx);
            if (tx.product_id) {
                const p = (await client.query("SELECT * FROM products WHERE id=$1 AND owner_id=$2 AND business_id=$3 FOR UPDATE", [tx.product_id, uid, businessId])).rows[0];
                if (!p)
                    throw new InputError("Produk tidak ditemukan");
                const stock = Number(p.stock) + Number(tx.quantity);
                if (!Number.isSafeInteger(stock))
                    throw new InputError("Stok di luar batas");
                await client.query("UPDATE products SET stock=$2,updated_at=to_timestamp($3/1000.0) WHERE id=$1", [p.id, stock, Math.max(now, p.updated_at.getTime() + 1)]);
            }
            await client.query("UPDATE transactions SET deleted_at=to_timestamp($2/1000.0),updated_at=to_timestamp($2/1000.0) WHERE id=$1", [id, now]);
        }
        return snapshot(client, uid);
    }));
}

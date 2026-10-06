import type { JWTPayload } from "jose";
import type { PoolClient } from "pg";
export type Identity = {
    uid: string;
    email: string;
    name: string;
};
export class InputError extends Error {
}
export function identityFrom(payload: JWTPayload): Identity {
    const email = String(payload.email ?? "")
        .trim()
        .toLowerCase();
    if (payload.email_verified !== true ||
        !email.endsWith("@students.untidar.ac.id")) {
        throw new InputError("Campus email is required");
    }
    if (!payload.sub)
        throw new InputError("Missing subject");
    return {
        uid: payload.sub,
        email,
        name: String(payload.name ?? email.split("@")[0]),
    };
}
export type BusinessInput = {
    id: string;
    name: string;
    type: string;
    initialCapital: number;
    createdAt: number;
    updatedAt: number;
};
export type TransactionInput = {
    id: string;
    businessId: string;
    type: "INCOME" | "EXPENSE";
    amount: number;
    category: string;
    paymentMethod: string;
    note: string;
    transactionDate: number;
    createdAt: number;
    updatedAt: number;
    deletedAt: number | null;
    productId: string | null;
    quantity: number | null;
};
export type ProductInput = {
    id: string;
    businessId: string;
    name: string;
    price: number;
    stock: number;
    createdAt: number;
    updatedAt: number;
    deletedAt: number | null;
};
export function requireBusiness(value: unknown): BusinessInput {
    const v = value as Record<string, unknown>;
    if (!v ||
        typeof v.id !== "string" ||
        typeof v.name !== "string" ||
        v.name.trim().length < 2) {
        throw new InputError("Invalid business");
    }
    return {
        id: requireUuid(v.id),
        name: v.name.trim().slice(0, 80),
        type: String(v.type ?? "Lainnya").slice(0, 40),
        initialCapital: safeInteger(v.initialCapital, true),
        createdAt: safeTimestamp(v.createdAt),
        updatedAt: safeTimestamp(v.updatedAt),
    };
}
export function requireTransactions(value: unknown): TransactionInput[] {
    if (!Array.isArray(value) || value.length > 500)
        throw new InputError("Invalid transactions");
    return value.map((entry) => {
        const v = entry as Record<string, unknown>;
        if (!v || typeof v !== "object")
            throw new InputError("Invalid transaction");
        const type = String(v.type);
        const paymentMethod = String(v.paymentMethod);
        if (!v.id || !v.businessId || !["INCOME", "EXPENSE"].includes(type))
            throw new InputError("Invalid transaction");
        if (!["Tunai", "QRIS", "Transfer"].includes(paymentMethod))
            throw new InputError("Invalid payment method");
        const rawProductId = v.productId;
        const productId = rawProductId == null || String(rawProductId).trim() === ""
            ? null
            : requireUuid(rawProductId);
        const quantity = v.quantity == null ? null : safeInteger(v.quantity, false);
        if (quantity != null && quantity > 2147483647)
            throw new InputError("Quantity too large");
        if ((productId == null) !== (quantity == null))
            throw new InputError("Invalid transaction product");
        if (productId != null && type !== "INCOME")
            throw new InputError("Invalid transaction product");
        return {
            id: requireUuid(v.id),
            businessId: requireUuid(v.businessId),
            type: type as "INCOME" | "EXPENSE",
            amount: safeInteger(v.amount, false),
            category: String(v.category ?? "Lainnya").slice(0, 60),
            paymentMethod,
            note: String(v.note ?? "").slice(0, 120),
            transactionDate: safeTimestamp(v.transactionDate),
            createdAt: safeTimestamp(v.createdAt),
            updatedAt: safeTimestamp(v.updatedAt),
            deletedAt: v.deletedAt == null ? null : safeTimestamp(v.deletedAt),
            productId,
            quantity,
        };
    });
}
export function requireProducts(value: unknown): ProductInput[] {
    if (!Array.isArray(value) || value.length > 500)
        throw new InputError("Invalid products");
    return value.map((entry) => {
        const v = entry as Record<string, unknown>;
        if (!v ||
            !v.id ||
            !v.businessId ||
            typeof v.name !== "string" ||
            v.name.trim().length < 1) {
            throw new InputError("Invalid product");
        }
        return {
            id: requireUuid(v.id),
            businessId: requireUuid(v.businessId),
            name: v.name.trim().slice(0, 80),
            price: safeInteger(v.price, true),
            stock: safeInteger(v.stock, true),
            createdAt: safeTimestamp(v.createdAt),
            updatedAt: safeTimestamp(v.updatedAt),
            deletedAt: v.deletedAt == null ? null : safeTimestamp(v.deletedAt),
        };
    });
}
function safeInteger(value: unknown, allowZero: boolean): number {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1))
        throw new InputError("Invalid amount");
    return number;
}
function safeTimestamp(value: unknown): number {
    const number = Number(value);
    if (!Number.isSafeInteger(number) ||
        number < 0 ||
        number > 8640000000000000)
        throw new InputError("Invalid timestamp");
    return number;
}
export function requireUuid(value: unknown): string {
    if (typeof value !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        throw new InputError("Invalid identifier");
    }
    return value.toLowerCase();
}
export async function upsertIdentity(client: PoolClient, identity: Identity) {
    await client.query(`INSERT INTO app_users(firebase_uid, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (firebase_uid) DO UPDATE SET
       email = EXCLUDED.email, display_name = EXCLUDED.display_name, updated_at = now()`, [identity.uid, identity.email, identity.name]);
}
// V1 compatibility: old clients represent only the original business.
export async function upsertBusiness(client: PoolClient, uid: string, b: BusinessInput) {
    await client.query("SELECT firebase_uid FROM app_users WHERE firebase_uid=$1 FOR UPDATE", [uid]);
    const existing = await client.query("SELECT id FROM businesses WHERE owner_id=$1 AND id=COALESCE((SELECT legacy_business_id FROM app_users WHERE firebase_uid=$1),id) ORDER BY created_at, id LIMIT 1", [uid]);
    const id = existing.rows[0]?.id ?? b.id;
    const plan = (await client.query("SELECT free_business_id, COALESCE(premium_until>now(),false) AS premium FROM app_users WHERE firebase_uid=$1", [uid])).rows[0];
    if (!plan.premium && plan.free_business_id && plan.free_business_id !== id) {
        throw new InputError("Upgrade aplikasi untuk memilih bisnis gratis aktif");
    }
    await writeBusiness(client, uid, { ...b, id });
    await client.query("UPDATE app_users SET free_business_id=COALESCE(free_business_id,$2::uuid),legacy_business_id=COALESCE(legacy_business_id,$2::uuid) WHERE firebase_uid=$1", [uid, id]);
}
export async function writeBusiness(client: PoolClient, uid: string, b: BusinessInput) {
    const result = await client.query(`INSERT INTO businesses(id,owner_id,name,type,initial_capital,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,to_timestamp($6/1000.0),to_timestamp($7/1000.0))
     ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,type=EXCLUDED.type,
       initial_capital=EXCLUDED.initial_capital,updated_at=EXCLUDED.updated_at
     WHERE businesses.owner_id=$2 AND EXCLUDED.updated_at>=businesses.updated_at RETURNING id`, [b.id, uid, b.name, b.type, b.initialCapital, b.createdAt, b.updatedAt]);
    if (!result.rowCount)
        await requireOwnedId(client, "businesses", b.id, uid, b.id);
}
export async function upsertTransaction(client: PoolClient, uid: string, businessId: string, t: TransactionInput) {
    const result = await client.query(`INSERT INTO transactions(
       id, business_id, owner_id, type, amount, category, payment_method, note,
       transaction_date, created_at, updated_at, deleted_at, product_id, quantity
     ) SELECT $1, b.id, $2, $3, $4, $5, $6, $7,
              to_timestamp($8 / 1000.0), to_timestamp($9 / 1000.0), to_timestamp($10 / 1000.0),
              CASE WHEN $11::bigint IS NULL THEN NULL ELSE to_timestamp($11 / 1000.0) END,
              $13::uuid, $14::int
         FROM businesses b WHERE b.id = $12 AND b.owner_id = $2
     ON CONFLICT (id) DO UPDATE SET
       type = EXCLUDED.type, amount = EXCLUDED.amount, category = EXCLUDED.category,
       payment_method = EXCLUDED.payment_method, note = EXCLUDED.note,
       transaction_date = EXCLUDED.transaction_date, updated_at = EXCLUDED.updated_at,
       deleted_at = EXCLUDED.deleted_at,
       product_id = EXCLUDED.product_id, quantity = EXCLUDED.quantity
     WHERE transactions.owner_id = $2 AND transactions.business_id = $12 AND EXCLUDED.updated_at >= transactions.updated_at
     RETURNING id`, [
        t.id,
        uid,
        t.type,
        t.amount,
        t.category,
        t.paymentMethod,
        t.note,
        t.transactionDate,
        t.createdAt,
        t.updatedAt,
        t.deletedAt,
        businessId,
        t.productId,
        t.quantity,
    ]);
    if (result.rowCount === 0)
        await requireOwnedId(client, "transactions", t.id, uid, businessId);
}
export async function upsertProduct(client: PoolClient, uid: string, businessId: string, p: ProductInput) {
    const result = await client.query(`INSERT INTO products(
       id, business_id, owner_id, name, price, stock,
       created_at, updated_at, deleted_at
     ) SELECT $1, b.id, $2, $3, $4, $5,
              to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0),
              CASE WHEN $8::bigint IS NULL THEN NULL ELSE to_timestamp($8 / 1000.0) END
         FROM businesses b WHERE b.id = $9 AND b.owner_id = $2
     ON CONFLICT (id) DO UPDATE SET
       name = CASE WHEN EXCLUDED.updated_at >= products.updated_at THEN EXCLUDED.name ELSE products.name END,
       price = CASE WHEN EXCLUDED.updated_at >= products.updated_at THEN EXCLUDED.price ELSE products.price END,
       stock = CASE WHEN EXCLUDED.updated_at >= products.updated_at THEN EXCLUDED.stock ELSE products.stock END,
       updated_at = GREATEST(products.updated_at, EXCLUDED.updated_at),
       deleted_at = COALESCE(products.deleted_at, EXCLUDED.deleted_at)
     WHERE products.owner_id = $2 AND products.business_id = $9 AND (EXCLUDED.updated_at >= products.updated_at OR EXCLUDED.deleted_at IS NOT NULL)
     RETURNING id`, [
        p.id,
        uid,
        p.name,
        p.price,
        p.stock,
        p.createdAt,
        p.updatedAt,
        p.deletedAt,
        businessId,
    ]);
    if (result.rowCount === 0)
        await requireOwnedId(client, "products", p.id, uid, businessId);
}
async function requireOwnedId(client: PoolClient, table: "products" | "transactions" | "businesses", id: string, uid: string, businessId: string) {
    const result = await client.query(`SELECT owner_id, ${table == "businesses" ? "id" : "business_id"} AS business_id FROM ${table} WHERE id = $1`, [id]);
    if (result.rows.length && (result.rows[0].owner_id !== uid || result.rows[0].business_id !== businessId))
        throw new InputError("Invalid identifier");
}
export function toApiProduct(row: Record<string, unknown>) {
    const millis = (value: unknown) => value == null
        ? null
        : value instanceof Date
            ? value.getTime()
            : new Date(String(value)).getTime();
    return {
        id: row.id,
        businessId: row.business_id,
        name: row.name,
        price: Number(row.price),
        stock: Number(row.stock),
        createdAt: millis(row.created_at),
        updatedAt: millis(row.updated_at),
        deletedAt: millis(row.deleted_at),
    };
}
export function toApiTransaction(row: Record<string, unknown>) {
    const millis = (value: unknown) => value == null
        ? null
        : value instanceof Date
            ? value.getTime()
            : new Date(String(value)).getTime();
    return {
        id: row.id,
        businessId: row.business_id,
        type: row.type,
        amount: Number(row.amount),
        category: row.category,
        paymentMethod: row.payment_method,
        note: row.note,
        transactionDate: millis(row.transaction_date),
        createdAt: millis(row.created_at),
        updatedAt: millis(row.updated_at),
        deletedAt: millis(row.deleted_at),
        productId: row.product_id ?? null,
        quantity: row.quantity == null ? null : Number(row.quantity),
    };
}
export function toApiBusiness(row: Record<string, unknown>) {
    const millis = (value: unknown) => value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
    return {
        id: row.id,
        name: row.name,
        type: row.type,
        initialCapital: Number(row.initial_capital),
        createdAt: millis(row.created_at),
        updatedAt: millis(row.updated_at),
    };
}

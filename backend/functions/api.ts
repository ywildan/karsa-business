import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { Pool, type PoolClient } from "pg";
import { firebaseProjectId } from "./config.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || firebaseProjectId === "__FIREBASE_PROJECT_ID__") {
  throw new Error("DATABASE_URL and Firebase project configuration are required");
}

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const jwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

type Identity = { uid: string; email: string; name: string };
type Variables = { identity: Identity };
const app = new Hono<{ Variables: Variables }>();

app.use("/v1/*", async (c, next) => {
  const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://securetoken.google.com/${firebaseProjectId}`,
      audience: firebaseProjectId,
    });
    const identity = identityFrom(payload);
    c.set("identity", identity);
    await next();
  } catch {
    return c.json({ error: "Invalid authentication token" }, 401);
  }
});

app.get("/health", (c) => c.json({ status: "ok", service: "karsa-business-api" }));

app.get("/v1/snapshot", async (c) => {
  const identity = c.get("identity");
  const client = await pool.connect();
  try {
    await upsertIdentity(client, identity);
    const businessResult = await client.query(
      `SELECT id, name, type, initial_capital, created_at, updated_at
         FROM businesses WHERE owner_id = $1 LIMIT 1`,
      [identity.uid],
    );
    const transactionResult = await client.query(
      `SELECT id, business_id, type, amount, category, payment_method, note,
              transaction_date, created_at, updated_at, deleted_at, product_id, quantity
         FROM transactions WHERE owner_id = $1 ORDER BY transaction_date DESC`,
      [identity.uid],
    );
    const productResult = await client.query(
      `SELECT id, business_id, name, price, stock, created_at, updated_at, deleted_at
         FROM products WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY name`,
      [identity.uid],
    );
    return c.json({
      business: businessResult.rows[0] ? toApiBusiness(businessResult.rows[0]) : null,
      transactions: transactionResult.rows.map(toApiTransaction),
      products: productResult.rows.map(toApiProduct),
    });
  } finally {
    client.release();
  }
});

app.post("/v1/sync", async (c) => {
  const identity = c.get("identity");
  const body = await c.req.json<Record<string, unknown>>();
  const business = requireBusiness(body.business);
  const transactions = requireTransactions(body.transactions);
  // Older clients do not send products yet; treat a missing array as empty.
  const products = body.products == null ? [] : requireProducts(body.products);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await upsertIdentity(client, identity);
    await upsertBusiness(client, identity.uid, business);
    const canonical = await client.query(
      `SELECT id FROM businesses WHERE owner_id = $1 LIMIT 1`,
      [identity.uid],
    );
    const businessId = String(canonical.rows[0].id);
    for (const product of products) {
      await upsertProduct(client, identity.uid, businessId, product);
    }
    const productIds = new Set(
      (
        await client.query(
          `SELECT id FROM products WHERE business_id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
          [businessId, identity.uid],
        )
      ).rows.map((row) => String(row.id)),
    );
    for (const transaction of transactions) {
      if (transaction.productId && !productIds.has(transaction.productId)) {
        throw new Error("Unknown product");
      }
      await upsertTransaction(client, identity.uid, businessId, transaction);
    }
    const businessResult = await client.query(
      `SELECT id, name, type, initial_capital, created_at, updated_at
         FROM businesses WHERE owner_id = $1 LIMIT 1`,
      [identity.uid],
    );
    const result = await client.query(
      `SELECT id, business_id, type, amount, category, payment_method, note,
              transaction_date, created_at, updated_at, deleted_at, product_id, quantity
         FROM transactions
        WHERE owner_id = $1
        ORDER BY transaction_date DESC`,
      [identity.uid],
    );
    const syncedProducts = await client.query(
      `SELECT id, business_id, name, price, stock, created_at, updated_at, deleted_at
         FROM products WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY name`,
      [identity.uid],
    );
    await client.query("COMMIT");
    return c.json({
      business: toApiBusiness(businessResult.rows[0]),
      transactions: result.rows.map(toApiTransaction),
      products: syncedProducts.rows.map(toApiProduct),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return c.json({ error: "Sync failed" }, 400);
  } finally {
    client.release();
  }
});

function identityFrom(payload: JWTPayload): Identity {
  const email = String(payload.email ?? "").trim().toLowerCase();
  if (payload.email_verified !== true || !email.endsWith("@students.untidar.ac.id")) {
    throw new Error("Campus email is required");
  }
  if (!payload.sub) throw new Error("Missing subject");
  return { uid: payload.sub, email, name: String(payload.name ?? email.split("@")[0]) };
}

type BusinessInput = {
  id: string; name: string; type: string; initialCapital: number; createdAt: number; updatedAt: number;
};
type TransactionInput = {
  id: string; businessId: string; type: "INCOME" | "EXPENSE"; amount: number;
  category: string; paymentMethod: string; note: string; transactionDate: number;
  createdAt: number; updatedAt: number; deletedAt: number | null;
  productId: string | null; quantity: number | null;
};
type ProductInput = {
  id: string; businessId: string; name: string; price: number; stock: number;
  createdAt: number; updatedAt: number; deletedAt: number | null;
};

function requireBusiness(value: unknown): BusinessInput {
  const v = value as Record<string, unknown>;
  if (!v || typeof v.id !== "string" || typeof v.name !== "string" || v.name.trim().length < 2) {
    throw new Error("Invalid business");
  }
  return {
    id: v.id,
    name: v.name.trim().slice(0, 80),
    type: String(v.type ?? "Lainnya").slice(0, 40),
    initialCapital: safeInteger(v.initialCapital, true),
    createdAt: safeTimestamp(v.createdAt),
    updatedAt: safeTimestamp(v.updatedAt),
  };
}

function requireTransactions(value: unknown): TransactionInput[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error("Invalid transactions");
  return value.map((entry) => {
    const v = entry as Record<string, unknown>;
    const type = String(v.type);
    const paymentMethod = String(v.paymentMethod);
    if (!v.id || !v.businessId || !["INCOME", "EXPENSE"].includes(type)) throw new Error("Invalid transaction");
    if (!["Tunai", "QRIS", "Transfer"].includes(paymentMethod)) throw new Error("Invalid payment method");
    const rawProductId = v.productId;
    const productId = rawProductId == null || String(rawProductId).trim() === "" ? null : String(rawProductId);
    const quantity = v.quantity == null ? null : safeInteger(v.quantity, false);
    if ((productId == null) !== (quantity == null)) throw new Error("Invalid transaction product");
    if (productId != null && type !== "INCOME") throw new Error("Invalid transaction product");
    return {
      id: String(v.id),
      businessId: String(v.businessId),
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

function requireProducts(value: unknown): ProductInput[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error("Invalid products");
  return value.map((entry) => {
    const v = entry as Record<string, unknown>;
    if (!v.id || !v.businessId || typeof v.name !== "string" || v.name.trim().length < 1) {
      throw new Error("Invalid product");
    }
    return {
      id: String(v.id),
      businessId: String(v.businessId),
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
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) throw new Error("Invalid amount");
  return number;
}

function safeTimestamp(value: unknown): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Invalid timestamp");
  return number;
}

async function upsertIdentity(client: PoolClient, identity: Identity) {
  await client.query(
    `INSERT INTO app_users(firebase_uid, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (firebase_uid) DO UPDATE SET
       email = EXCLUDED.email, display_name = EXCLUDED.display_name, updated_at = now()`,
    [identity.uid, identity.email, identity.name],
  );
}

async function upsertBusiness(client: PoolClient, uid: string, b: BusinessInput) {
  await client.query(
    `INSERT INTO businesses(id, owner_id, name, type, initial_capital, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0))
     ON CONFLICT (owner_id) DO UPDATE SET
       name = EXCLUDED.name, type = EXCLUDED.type, initial_capital = EXCLUDED.initial_capital,
       updated_at = GREATEST(businesses.updated_at, EXCLUDED.updated_at)`,
    [b.id, uid, b.name, b.type, b.initialCapital, b.createdAt, b.updatedAt],
  );
}

async function upsertTransaction(client: PoolClient, uid: string, businessId: string, t: TransactionInput) {
  if (t.businessId !== businessId) throw new Error("Business mismatch");
  await client.query(
    `INSERT INTO transactions(
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
     WHERE transactions.owner_id = $2 AND EXCLUDED.updated_at >= transactions.updated_at`,
    [t.id, uid, t.type, t.amount, t.category, t.paymentMethod, t.note, t.transactionDate,
      t.createdAt, t.updatedAt, t.deletedAt, businessId, t.productId, t.quantity],
  );
}

async function upsertProduct(client: PoolClient, uid: string, businessId: string, p: ProductInput) {
  if (p.businessId !== businessId) throw new Error("Business mismatch");
  await client.query(
    `INSERT INTO products(
       id, business_id, owner_id, name, price, stock,
       created_at, updated_at, deleted_at
     ) SELECT $1, b.id, $2, $3, $4, $5,
              to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0),
              CASE WHEN $8::bigint IS NULL THEN NULL ELSE to_timestamp($8 / 1000.0) END
         FROM businesses b WHERE b.id = $9 AND b.owner_id = $2
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, price = EXCLUDED.price, stock = EXCLUDED.stock,
       updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at
     WHERE products.owner_id = $2 AND EXCLUDED.updated_at >= products.updated_at`,
    [p.id, uid, p.name, p.price, p.stock, p.createdAt, p.updatedAt, p.deletedAt, businessId],
  );
}

function toApiProduct(row: Record<string, unknown>) {
  const millis = (value: unknown) => value == null ? null : new Date(String(value)).getTime();
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

function toApiTransaction(row: Record<string, unknown>) {
  const millis = (value: unknown) => value == null ? null : new Date(String(value)).getTime();
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

function toApiBusiness(row: Record<string, unknown>) {
  const millis = (value: unknown) => new Date(String(value)).getTime();
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    initialCapital: Number(row.initial_capital),
    createdAt: millis(row.created_at),
    updatedAt: millis(row.updated_at),
  };
}

export default app;

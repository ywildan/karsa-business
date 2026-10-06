import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { InputError, requireBusiness, requireProducts, requireTransactions, upsertIdentity, upsertBusiness, upsertProduct, upsertTransaction, toApiBusiness, toApiProduct, toApiTransaction, type Identity } from "./records.js";
import { registerPremiumApi } from "./premium-api.js";
export { identityFrom } from "./records.js";
export type { Identity } from "./records.js";
import type { Pool, PoolClient } from "pg";

export type Variables = { identity: Identity };
export function createApi(
  pool: Pool,
  authenticate: (token: string) => Promise<Identity>,
) {
  const app = new Hono<{ Variables: Variables }>();
  app.use("*", bodyLimit({maxSize: 1_048_576}));
  app.onError((error, c) => {
    if (error instanceof InputError)
      return c.json({ error: error.message, code: "INVALID_REQUEST" }, 400);
    console.error(
      "API failed",
      error instanceof Error ? error.name : "Unknown error",
    );
    return c.json(
      { error: "Server temporarily unavailable", code: "SERVER_ERROR" },
      503,
    );
  });

  const guard: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
    const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    let identity: Identity;
    try {
      identity = await authenticate(token);
    } catch {
      return c.json(
        { error: "Invalid authentication token", code: "AUTH_REQUIRED" },
        401,
      );
    }
    c.set("identity", identity);
    c.header("Cache-Control", "no-store");
    await next();
  };
  app.use("/v1/*", guard);
  app.use("/v2/*", guard);

  app.get("/health", (c) =>
    c.json({ status: "ok", service: "karsa-business-api" }),
  );

  app.get("/v1/snapshot", async (c) => {
    const identity = c.get("identity");
    const client = await pool.connect();
    try {
      await upsertIdentity(client, identity);
      const businessResult = await client.query(
        `SELECT id, name, type, initial_capital, created_at, updated_at
         FROM businesses WHERE owner_id = $1 AND id = COALESCE((SELECT legacy_business_id FROM app_users WHERE firebase_uid=$1),id) ORDER BY created_at, id LIMIT 1`,
        [identity.uid],
      );
      const transactionResult = await client.query(
        `SELECT id, business_id, type, amount, category, payment_method, note,
              transaction_date, created_at, updated_at, deleted_at, product_id, quantity
         FROM transactions WHERE owner_id = $1 AND business_id = $2 ORDER BY transaction_date DESC`,
        [identity.uid, businessResult.rows[0]?.id ?? null],
      );
      const productResult = await client.query(
        `SELECT id, business_id, name, price, stock, created_at, updated_at, deleted_at
         FROM products WHERE owner_id = $1 AND business_id = $2 ORDER BY name`,
        [identity.uid, businessResult.rows[0]?.id ?? null],
      );
      return c.json({
        business: businessResult.rows[0]
          ? toApiBusiness(businessResult.rows[0])
          : null,
        transactions: transactionResult.rows.map(toApiTransaction),
        products: productResult.rows.map(toApiProduct),
      });
    } finally {
      client.release();
    }
  });

  app.post("/v1/sync", async (c) => {
    const identity = c.get("identity");
    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new InputError();
    } catch {
      throw new InputError("Invalid JSON body");
    }
    const business = requireBusiness(body.business);
    const transactions = requireTransactions(body.transactions);
    // Older clients do not send products yet; treat a missing array as empty.
    const products =
      body.products == null ? [] : requireProducts(body.products);
    if (
      [...transactions, ...products].some(
        (row) => row.businessId !== business.id,
      )
    ) {
      throw new InputError("Items must belong to the submitted business");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await upsertIdentity(client, identity);
      await upsertBusiness(client, identity.uid, business);
      const canonical = await client.query(
        `SELECT id FROM businesses WHERE owner_id = $1 AND id = COALESCE((SELECT legacy_business_id FROM app_users WHERE firebase_uid=$1),id) ORDER BY created_at, id LIMIT 1`,
        [identity.uid],
      );
      const businessId = String(canonical.rows[0].id);
      for (const product of products) {
        await upsertProduct(client, identity.uid, businessId, product);
      }
      const productIds = new Set(
        (
          await client.query(
            `SELECT id FROM products WHERE business_id = $1 AND owner_id = $2`,
            [businessId, identity.uid],
          )
        ).rows.map((row) => String(row.id)),
      );
      for (const transaction of transactions) {
        if (transaction.productId && !productIds.has(transaction.productId)) {
          throw new InputError("Unknown product");
        }
        await upsertTransaction(client, identity.uid, businessId, transaction);
      }
      const businessResult = await client.query(
        `SELECT id, name, type, initial_capital, created_at, updated_at
         FROM businesses WHERE owner_id = $1 AND id = COALESCE((SELECT legacy_business_id FROM app_users WHERE firebase_uid=$1),id) ORDER BY created_at, id LIMIT 1`,
        [identity.uid],
      );
      const result = await client.query(
        `SELECT id, business_id, type, amount, category, payment_method, note,
              transaction_date, created_at, updated_at, deleted_at, product_id, quantity
         FROM transactions
        WHERE owner_id = $1 AND business_id = $2
        ORDER BY transaction_date DESC`,
        [identity.uid, businessResult.rows[0]?.id ?? null],
      );
      const syncedProducts = await client.query(
        `SELECT id, business_id, name, price, stock, created_at, updated_at, deleted_at
         FROM products WHERE owner_id = $1 AND business_id = $2 ORDER BY name`,
        [identity.uid, businessResult.rows[0]?.id ?? null],
      );
      await client.query("COMMIT");
      return c.json({
        business: toApiBusiness(businessResult.rows[0]),
        transactions: result.rows.map(toApiTransaction),
        products: syncedProducts.rows.map(toApiProduct),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof InputError)
        return c.json({ error: error.message, code: "INVALID_REQUEST" }, 400);
      if ((error as { code?: string }).code === "23505")
        return c.json({ error: "Data conflict", code: "DATA_CONFLICT" }, 409);
      throw error;
    } finally {
      client.release();
    }
  });

  registerPremiumApi(app, pool);
  return app;
}

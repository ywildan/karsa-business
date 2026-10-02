-- 002_products.sql: product catalog + per-sale product line items.
-- Safe to re-run: uses IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES app_users(firebase_uid) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    price BIGINT NOT NULL DEFAULT 0 CHECK (price >= 0),
    stock BIGINT NOT NULL DEFAULT 0 CHECK (stock >= 0),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS products_owner_idx ON products(owner_id);
CREATE INDEX IF NOT EXISTS products_business_idx ON products(business_id);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS quantity INTEGER CHECK (quantity IS NULL OR quantity > 0);

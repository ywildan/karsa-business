-- Preserve every existing business and row; allow up to five per Premium account.
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_owner_id_key;
CREATE INDEX IF NOT EXISTS businesses_owner_idx ON businesses(owner_id, created_at, id);
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS premium_until TIMESTAMPTZ;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS free_business_id UUID REFERENCES businesses(id);
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS legacy_business_id UUID REFERENCES businesses(id);
UPDATE app_users u SET free_business_id = (
    SELECT b.id FROM businesses b WHERE b.owner_id = u.firebase_uid
    ORDER BY b.created_at, b.id LIMIT 1
) WHERE free_business_id IS NULL;
UPDATE app_users SET legacy_business_id = free_business_id WHERE legacy_business_id IS NULL;

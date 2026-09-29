CREATE TABLE IF NOT EXISTS app_users (
    firebase_uid TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT untidar_student_email CHECK (lower(email) LIKE '%@students.untidar.ac.id')
);

CREATE TABLE IF NOT EXISTS businesses (
    id UUID PRIMARY KEY,
    owner_id TEXT NOT NULL UNIQUE REFERENCES app_users(firebase_uid) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
    type TEXT NOT NULL,
    initial_capital BIGINT NOT NULL DEFAULT 0 CHECK (initial_capital >= 0),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES app_users(firebase_uid) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('INCOME', 'EXPENSE')),
    amount BIGINT NOT NULL CHECK (amount > 0),
    category TEXT NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('Tunai', 'QRIS', 'Transfer')),
    note TEXT NOT NULL DEFAULT '',
    transaction_date TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS transactions_owner_date_idx
    ON transactions(owner_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS transactions_business_idx
    ON transactions(business_id);


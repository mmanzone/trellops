-- Trellops server-side records (subscription plan, phase 1).
-- Safe to run repeatedly: every statement is idempotent.
-- Applied automatically by the API on first use, or manually with `npm run db:migrate`.

-- One row per Trello account that has signed in to Trellops.
CREATE TABLE IF NOT EXISTS users (
    trello_member_id  TEXT PRIMARY KEY,
    username          TEXT,
    full_name         TEXT,
    email             TEXT,
    has_email_scope   BOOLEAN     NOT NULL DEFAULT FALSE,
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    login_count       INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_last_seen_idx ON users (last_seen_at DESC);

-- Audit log: sign-ins now; webhooks and admin changes in later phases.
CREATE TABLE IF NOT EXISTS events (
    id                BIGSERIAL PRIMARY KEY,
    type              TEXT        NOT NULL,
    trello_member_id  TEXT,
    payload           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS events_type_created_idx ON events (type, created_at DESC);
CREATE INDEX IF NOT EXISTS events_member_idx ON events (trello_member_id, created_at DESC);

-- Phase 2: admin dashboard ---------------------------------------------------

-- Board ids each member has configured in Trellops (ids only, never names).
CREATE TABLE IF NOT EXISTS user_boards (
    trello_member_id  TEXT        NOT NULL,
    board_id          TEXT        NOT NULL,
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (trello_member_id, board_id)
);

CREATE INDEX IF NOT EXISTS user_boards_board_idx ON user_boards (board_id);

-- Plans granted by an admin without payment (charities, beta testers, support).
CREATE TABLE IF NOT EXISTS overrides (
    id                BIGSERIAL PRIMARY KEY,
    target_type       TEXT        NOT NULL CHECK (target_type IN ('user', 'board')),
    target_id         TEXT        NOT NULL,
    plan_code         TEXT        NOT NULL,
    pack_quantity     INTEGER     NOT NULL DEFAULT 0,
    reason            TEXT        NOT NULL,
    org_name          TEXT,
    note              TEXT,
    granted_by        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ,
    revoked_at        TIMESTAMPTZ,
    revoked_by        TEXT
);

CREATE INDEX IF NOT EXISTS overrides_target_idx ON overrides (target_type, target_id);

-- Requests for a free Board plan from charities and NGOs, reviewed by an admin.
CREATE TABLE IF NOT EXISTS comp_requests (
    id                BIGSERIAL PRIMARY KEY,
    trello_member_id  TEXT        NOT NULL,
    board_id          TEXT        NOT NULL,
    charity_name      TEXT        NOT NULL,
    charity_type      TEXT        NOT NULL,
    intended_use      TEXT        NOT NULL,
    country           TEXT        NOT NULL,
    justification     TEXT        NOT NULL,
    status            TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at       TIMESTAMPTZ,
    reviewed_by       TEXT,
    override_id       BIGINT
);

CREATE INDEX IF NOT EXISTS comp_requests_status_idx ON comp_requests (status, created_at DESC);

-- Phase 3: entitlements and gating ------------------------------------------

-- Plan rules. Limits, refresh and features are edited here, not in code.
-- Seeded once; later edits in the database are kept (ON CONFLICT DO NOTHING).
CREATE TABLE IF NOT EXISTS plans (
    code                 TEXT PRIMARY KEY,
    name                 TEXT        NOT NULL,
    board_limit          INTEGER     NOT NULL DEFAULT 0,
    boards_per_pack      INTEGER     NOT NULL DEFAULT 0,
    min_refresh_seconds  INTEGER     NOT NULL DEFAULT 3600,
    features             JSONB       NOT NULL DEFAULT '[]'::jsonb,
    paddle_price_ids     TEXT[]      NOT NULL DEFAULT '{}',
    active               BOOLEAN     NOT NULL DEFAULT TRUE,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO plans (code, name, board_limit, boards_per_pack, min_refresh_seconds, features) VALUES
    ('free',  'Free',       1, 0, 3600, '[]'::jsonb),
    ('pro',   'Pro',        5, 5,   60, '["map","stats","tasks","ai","share","export","slideshow","keepScreenOn","sync"]'::jsonb),
    ('board', 'Board plan', 0, 0,   60, '["map","stats","tasks","ai","slideshow","keepScreenOn"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- Paid plans, written by the Paddle webhook in phase 4.
CREATE TABLE IF NOT EXISTS subscriptions (
    paddle_subscription_id  TEXT PRIMARY KEY,
    trello_member_id        TEXT        NOT NULL,
    kind                    TEXT        NOT NULL CHECK (kind IN ('user', 'board')),
    board_id                TEXT,
    status                  TEXT        NOT NULL,
    plan_code               TEXT        NOT NULL,
    pack_quantity           INTEGER     NOT NULL DEFAULT 0,
    current_period_end      TIMESTAMPTZ,
    canceled_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscriptions_member_idx ON subscriptions (trello_member_id);
CREATE INDEX IF NOT EXISTS subscriptions_board_idx ON subscriptions (board_id);

-- App-wide switches set from the admin dashboard (for example plan enforcement).
CREATE TABLE IF NOT EXISTS app_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB       NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  TEXT
);

-- A board a member removed to stay within their plan's board limit.
ALTER TABLE user_boards ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
-- Last time Trello confirmed this member belongs to the board (Board plan access).
ALTER TABLE user_boards ADD COLUMN IF NOT EXISTS member_checked_at TIMESTAMPTZ;

-- Pro configs saved on the server, so they follow the member to any device.
CREATE TABLE IF NOT EXISTS board_configs (
    trello_member_id  TEXT        NOT NULL,
    board_id          TEXT        NOT NULL,
    config            JSONB       NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (trello_member_id, board_id)
);

-- Share links (/?share=<id>) created by Pro members.
CREATE TABLE IF NOT EXISTS shares (
    id                TEXT PRIMARY KEY,
    trello_member_id  TEXT        NOT NULL,
    board_id          TEXT        NOT NULL,
    config            JSONB       NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS shares_member_idx ON shares (trello_member_id, created_at DESC);

-- Pricing page: prices per plan, edited from the admin page (US dollars).
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_monthly NUMERIC(10, 2);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_annual NUMERIC(10, 2);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS pack_price_monthly NUMERIC(10, 2);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS pack_price_annual NUMERIC(10, 2);
UPDATE plans SET price_monthly = 0, price_annual = 0 WHERE code = 'free' AND price_monthly IS NULL;
UPDATE plans SET price_monthly = 5, price_annual = 50, pack_price_monthly = 5, pack_price_annual = 50 WHERE code = 'pro' AND price_monthly IS NULL;
UPDATE plans SET price_monthly = 10, price_annual = 100 WHERE code = 'board' AND price_monthly IS NULL;

-- Paddle billing (phase 4). Price ids are pasted into the admin page per plan.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS paddle_price_monthly TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS paddle_price_annual TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS paddle_pack_price_monthly TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS paddle_pack_price_annual TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paddle_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_period TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paddle_updated_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS environment TEXT;

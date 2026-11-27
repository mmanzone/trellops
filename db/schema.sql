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

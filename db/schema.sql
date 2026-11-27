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

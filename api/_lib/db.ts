/**
 * Postgres access (Neon serverless driver over HTTP). DATABASE_URL is injected
 * by the Neon integration from the Vercel Marketplace. Until it is set, every
 * function here is a no-op, so sign-in keeps working without a database.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { SCHEMA_SQL } from './schema.js';
import type { TrelloMember } from './trello.js';

type Sql = NeonQueryFunction<false, false>;

let client: Sql | null | undefined;
let schemaReady: Promise<void> | null = null;

export function getDb(): Sql | null {
  if (client !== undefined) return client;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  client = url ? neon(url) : null;
  return client;
}

/** Test hook: swap the database client. */
export function __setDbForTests(sql: Sql | null) {
  client = sql;
  schemaReady = null;
}

export const splitStatements = (sqlText: string): string[] =>
  sqlText
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

/** Applies db/schema.sql once per function instance (all statements are idempotent). */
export function ensureSchema(sql: Sql): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const statement of splitStatements(SCHEMA_SQL)) {
        await sql.query(statement);
      }
    })().catch((e) => {
      schemaReady = null; // retry on the next request
      throw e;
    });
  }
  return schemaReady;
}

export interface LoginResult {
  recorded: boolean;
  newUser: boolean;
}

/**
 * Records a sign-in. `isNewSession` is false when the browser already held a
 * valid session cookie for this member (a page reload), which only bumps
 * last_seen_at so login_count reflects real sign-ins.
 */
export async function recordLogin(member: TrelloMember, isNewSession: boolean): Promise<LoginResult> {
  const sql = getDb();
  if (!sql) return { recorded: false, newUser: false };
  await ensureSchema(sql);

  const hasEmail = member.email !== null;
  const rows = (await sql.query(
    `INSERT INTO users (trello_member_id, username, full_name, email, has_email_scope, login_count)
     VALUES ($1, $2, $3, $4, $5, 1)
     ON CONFLICT (trello_member_id) DO UPDATE SET
       username        = EXCLUDED.username,
       full_name       = EXCLUDED.full_name,
       email           = COALESCE(EXCLUDED.email, users.email),
       has_email_scope = users.has_email_scope OR EXCLUDED.has_email_scope,
       last_seen_at    = NOW(),
       last_login_at   = CASE WHEN $6 THEN NOW() ELSE users.last_login_at END,
       login_count     = users.login_count + CASE WHEN $6 THEN 1 ELSE 0 END
     RETURNING (xmax = 0) AS inserted`,
    [member.id, member.username, member.fullName, member.email, hasEmail, isNewSession],
  )) as Array<{ inserted: boolean }>;
  const newUser = rows[0]?.inserted === true;

  if (isNewSession || newUser) {
    await sql.query(`INSERT INTO events (type, trello_member_id, payload) VALUES ($1, $2, $3::jsonb)`, [
      newUser ? 'signup' : 'login',
      member.id,
      JSON.stringify({ emailScope: hasEmail }),
    ]);
  }
  return { recorded: true, newUser };
}

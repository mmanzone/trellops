// Real Postgres (PGlite, in memory) behind the same `query` interface the
// Neon driver exposes, so API tests run the production SQL.
import { PGlite } from '@electric-sql/pglite';

export async function pgliteDb() {
  const db = new PGlite();
  const sql: any = () => { throw new Error('tagged template not used'); };
  sql.query = async (text: string, params: unknown[] = []) => (await db.query(text, params as any[])).rows;
  return { sql, db };
}

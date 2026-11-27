// Applies db/schema.sql to DATABASE_URL. Usage: DATABASE_URL=... npm run db:migrate
// Optional: the API also applies the schema automatically on first use.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.TRELLOPS_DATABASE_URL || process.env.POSTGRES_URL || process.env.TRELLOPS_POSTGRES_URL;
if (!url) {
  console.error('Set DATABASE_URL first (Vercel > Storage > your Neon database > .env.local).');
  process.exit(1);
}
const root = fileURLToPath(new URL('..', import.meta.url));
const statements = readFileSync(`${root}db/schema.sql`, 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  .split(';').map((s) => s.trim()).filter(Boolean);

const sql = neon(url);
for (const statement of statements) {
  await sql.query(statement);
  console.log('ok:', statement.split('\n')[0]);
}
console.log(`Applied ${statements.length} statements.`);

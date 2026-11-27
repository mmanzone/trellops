// Copies db/schema.sql into api/_lib/schema.ts so the API can apply it without
// reading files at runtime (Vercel bundles imports, not loose files).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sql = readFileSync(`${root}db/schema.sql`, 'utf8');
const out = `// Generated from db/schema.sql by scripts/build-schema.mjs. Do not edit by hand.\nexport const SCHEMA_SQL = ${JSON.stringify(sql)};\n`;
writeFileSync(`${root}api/_lib/schema.ts`, out);
console.log('api/_lib/schema.ts updated');

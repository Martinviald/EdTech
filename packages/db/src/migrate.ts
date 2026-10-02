import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

config({ path: resolve(__dirname, '../../../.env') });

// Las políticas RLS NO viven en el schema Drizzle (drizzle-kit no las regenera).
// Se aplican SIEMPRE de forma idempotente tras migrar, para que sobrevivan a
// cualquier db:generate / aplanamiento de migraciones. Ver sql/rls-policies.sql.
const RLS_POLICIES_PATH = resolve(__dirname, '../sql/rls-policies.sql');

// Mismo mecanismo para las extensiones que el buscador necesita (`unaccent`):
// tampoco las genera drizzle-kit, así que se re-aplican en cada migración.
// Ver sql/search-extensions.sql y docs/diseno-buscador-evaluaciones.md §D4.
const SEARCH_EXTENSIONS_PATH = resolve(__dirname, '../sql/search-extensions.sql');

async function main() {
  // migrate y seed usan un rol privilegiado (owner/superuser) que puede hacer DDL
  // y cargar datos sin contexto de org. La API usa DATABASE_URL (rol sujeto a RLS).
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  }

  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql);

  console.log('Applying search extensions (idempotent)...');
  await sql.unsafe(readFileSync(SEARCH_EXTENSIONS_PATH, 'utf-8'));
  console.log('Search extensions applied.');

  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: './drizzle/migrations' });
  console.log('Migrations completed.');

  console.log('Applying RLS policies (idempotent)...');
  const rlsSql = readFileSync(RLS_POLICIES_PATH, 'utf-8');
  await sql.unsafe(rlsSql);
  // El conteo se deriva del propio catálogo en vez de hardcodearse: la lista anterior
  // decía "9 tablas" y ya se había quedado corta. Un número escrito a mano acá miente
  // en silencio justo sobre lo que este archivo existe para garantizar.
  const rows = await sql<{ count: number }[]>`
    SELECT count(DISTINCT tablename)::int AS count
    FROM pg_policies
    WHERE schemaname = 'public' AND policyname LIKE '%_tenant_isolation'
  `;
  console.log(`RLS policies applied (${rows[0]?.count ?? 0} tablas con aislamiento por tenant).`);

  await sql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

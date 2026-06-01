/**
 * Resetea el schema de la base de datos: dropea `public` (y el schema `drizzle`
 * con el tracking de migraciones) y recrea `public` vacío.
 *
 * Es el primer paso de `pnpm db:reset`. Después corren migrate + seeds.
 *
 * ⚠️ DESTRUCTIVO: borra TODOS los datos. Por seguridad, solo se ejecuta contra
 * bases locales (localhost / 127.0.0.1). Para forzar contra otra base hay que
 * pasar `DB_RESET_CONFIRM=YES` explícitamente.
 *
 * Nota: además de `public`, dropea el schema `drizzle`. Ahí vive la tabla de
 * tracking `__drizzle_migrations`; si sobrevive, el migrador cree que las
 * migraciones ya están aplicadas y deja `public` vacío.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import postgres from 'postgres';

config({ path: resolve(__dirname, '../../../.env') });

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  // Guarda de seguridad: solo bases locales, salvo override explícito.
  let host = '';
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error('DATABASE_URL no es una URL válida');
  }
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLocal && process.env.DB_RESET_CONFIRM !== 'YES') {
    throw new Error(
      `Reset BLOQUEADO: DATABASE_URL apunta a "${host}" (no local). ` +
        `Si de verdad quieres resetear esa base, corre con DB_RESET_CONFIRM=YES.`,
    );
  }

  const sql = postgres(databaseUrl, { max: 1 });

  console.log(`⚠️  Reseteando schema de la base "${host}"...`);

  // Cerramos otras conexiones para que ningún lock bloquee el DROP SCHEMA
  // (p. ej. la app dev corriendo). Volverán a reconectar solas.
  await sql`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
  `;

  await sql.unsafe(`
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    DROP SCHEMA IF EXISTS drizzle CASCADE;
  `);

  console.log('✓ Schema public recreado; tracking de migraciones eliminado.');
  await sql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Reset de schema falló:', err);
  process.exit(1);
});

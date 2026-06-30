/**
 * Provisiona el rol `soe_app` (sin BYPASSRLS) en una BD ya creada (RDS en cloud).
 *
 * Idempotente. Es el espejo de packages/db/sql/roles.sql pero con el password
 * parametrizado por entorno (nunca hardcodeado). Correr UNA vez tras crear el RDS,
 * conectado con el rol admin/master, y ANTES de `db:migrate` (así las tablas que
 * cree migrate heredan los GRANT vía ALTER DEFAULT PRIVILEGES).
 *
 *   DATABASE_ADMIN_URL=postgresql://soe_admin:...@host:5432/soe \
 *   SOE_APP_PASSWORD=... \
 *   pnpm --filter @soe/db db:provision-roles
 *
 * Ver runbook: docs/deploy/aws-sst-nivel1.md
 */
import postgres from 'postgres';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appPassword = process.env.SOE_APP_PASSWORD;

if (!adminUrl) {
  throw new Error('Falta DATABASE_ADMIN_URL (rol admin/owner del RDS).');
}
if (!appPassword) {
  throw new Error('Falta SOE_APP_PASSWORD (password del rol soe_app).');
}

// El password se interpola en DDL (CREATE/ALTER ROLE no admite bind params).
// Viene de un secreto de confianza; escapamos la comilla simple por robustez.
const pw = appPassword.replace(/'/g, "''");

const sql = postgres(adminUrl, { max: 1 });

async function main(): Promise<void> {
  // 1. Crear el rol si no existe (sin BYPASSRLS -> queda sujeto a RLS).
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'soe_app') THEN
        CREATE ROLE soe_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
    END
    $$;
  `);

  // 2. Fijar/rotar el password y reasegurar atributos (idempotente).
  await sql.unsafe(
    `ALTER ROLE soe_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${pw}';`,
  );

  // 3. Permisos mínimos sobre el schema public (las políticas RLS hacen el resto).
  //    GRANT CONNECT sobre la BD actual (vía dynamic SQL, current_database()).
  await sql.unsafe(`
    DO $$
    BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO soe_app', current_database());
    END
    $$;
  `);
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO soe_app;`);
  await sql.unsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO soe_app;`,
  );
  await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO soe_app;`);

  // 4. Que las tablas/secuencias futuras (las que cree migrate como admin) también queden cubiertas.
  await sql.unsafe(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO soe_app;
  `);
  await sql.unsafe(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO soe_app;
  `);

  console.log('✅ Rol soe_app provisionado (LOGIN, NOBYPASSRLS, GRANTs + default privileges).');
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    await sql.end();
    console.error('❌ Error provisionando soe_app:', err);
    process.exit(1);
  });

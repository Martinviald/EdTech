-- ============================================================================
-- Roles de Postgres para enforcement de RLS (setup, NO es una migración)
-- ============================================================================
-- El RLS solo filtra si la API conecta con un rol que NO bypassa RLS.
-- Los superusers y los roles BYPASSRLS siempre bypassan las políticas.
--
-- Modelo de dos roles:
--   · soe_app   → usado por la API en runtime (DATABASE_URL).      Sujeto a RLS.
--   · migrate/seed → usan un rol privilegiado (DATABASE_ADMIN_URL): el owner del
--                    schema o un superuser. Bypassan RLS para poder hacer DDL y
--                    cargar datos sin contexto de org.
--
-- Uso (dev local), conectado como superuser (p.ej. postgres):
--   psql "$DATABASE_ADMIN_URL" -f packages/db/sql/roles.sql
-- Luego apuntar DATABASE_URL al rol soe_app y DATABASE_ADMIN_URL al superuser/owner.
--
-- Ajustar el password antes de correr en cada entorno. En producción usar secretos,
-- nunca hardcodear.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'soe_app') THEN
    CREATE ROLE soe_app LOGIN PASSWORD 'change_me_soe_app'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Permisos mínimos sobre el schema public (las políticas RLS hacen el resto).
GRANT CONNECT ON DATABASE current_database() TO soe_app;
GRANT USAGE ON SCHEMA public TO soe_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO soe_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO soe_app;

-- Que las tablas/secuencias creadas a futuro también queden cubiertas.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO soe_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO soe_app;

-- Permisos del rol de la API (soe_app, sin BYPASSRLS) sobre la BDD local de pruebas.
-- No toca el rol (password ni atributos): solo los GRANT de esta base. Idempotente.
\set ON_ERROR_STOP on
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO soe_app', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO soe_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO soe_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO soe_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO soe_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO soe_app;

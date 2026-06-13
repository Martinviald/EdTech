-- ============================================================================
-- H19.4 — Row Level Security (aislamiento multi-tenant, Ley 19.628)
-- ============================================================================
-- FUENTE DE VERDAD del RLS. NO vive en el schema Drizzle (packages/db/src/schema/*.ts),
-- por lo tanto drizzle-kit NO lo regenera: se aplica SIEMPRE de forma idempotente al
-- final de `pnpm db:migrate` (ver packages/db/src/migrate.ts).
--
-- ⚠️ NO BORRAR ESTE ARCHIVO. El RLS ya se perdió una vez al aplanar migraciones
--    (commit 53aa242). Este mecanismo existe precisamente para que no vuelva a pasar:
--    cualquier `db:generate` / squash futuro NO afecta estas políticas.
--
-- Notas de diseño:
--  · current_setting('app.current_org_id', true) retorna '' si la variable no está
--    fijada (no lanza error). Sin contexto => condición falsa => 0 filas (safe default).
--    El wrapper withOrgContext() (packages/db/src/with-org-context.ts) fija la variable
--    por transacción vía set_config(..., true).
--  · FORCE ROW LEVEL SECURITY hace que el RLS aplique TAMBIÉN al dueño de la tabla.
--    Sin FORCE, el rol dueño (y cualquier superuser) bypassa las políticas y el RLS
--    sería un no-op. Los superusers SIEMPRE bypassan (por eso migrate/seed usan un rol
--    privilegiado vía DATABASE_ADMIN_URL); la API debe conectar con un rol no-bypass.
--  · responses / assessment_results / skill_results no tienen org_id propio: heredan la
--    pertenencia de tenant vía EXISTS sobre assessments.
-- ============================================================================

-- ── Habilitar + forzar RLS (idempotente) ────────────────────────────────────
ALTER TABLE "students"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "students"            FORCE  ROW LEVEL SECURITY;
ALTER TABLE "assessments"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessments"         FORCE  ROW LEVEL SECURITY;
ALTER TABLE "import_jobs"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_jobs"         FORCE  ROW LEVEL SECURITY;
ALTER TABLE "responses"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "responses"           FORCE  ROW LEVEL SECURITY;
ALTER TABLE "assessment_results"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_results"  FORCE  ROW LEVEL SECURITY;
ALTER TABLE "skill_results"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skill_results"       FORCE  ROW LEVEL SECURITY;
ALTER TABLE "performance_bands"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "performance_bands"   FORCE  ROW LEVEL SECURITY;

-- ── Políticas con org_id directo ────────────────────────────────────────────
DROP POLICY IF EXISTS "students_tenant_isolation" ON "students";
CREATE POLICY "students_tenant_isolation" ON "students"
  AS PERMISSIVE FOR ALL
  USING (org_id::text = current_setting('app.current_org_id', true));

DROP POLICY IF EXISTS "assessments_tenant_isolation" ON "assessments";
CREATE POLICY "assessments_tenant_isolation" ON "assessments"
  AS PERMISSIVE FOR ALL
  USING (org_id::text = current_setting('app.current_org_id', true));

DROP POLICY IF EXISTS "import_jobs_tenant_isolation" ON "import_jobs";
CREATE POLICY "import_jobs_tenant_isolation" ON "import_jobs"
  AS PERMISSIVE FOR ALL
  USING (org_id::text = current_setting('app.current_org_id', true));

-- performance_bands tiene org_id NULLABLE: las filas con org_id IS NULL son el
-- catálogo global de plataforma (ej. bandas DIA por defecto) y deben ser visibles
-- para todos los tenants como fallback de niveles. Por eso la condición incluye
-- `org_id IS NULL` además del match por tenant. Esas filas no contienen PII
-- (sólo label/umbral/color), así que exponerlas sin contexto es intencional.
-- Con FOR ALL sin WITH CHECK explícito, Postgres hereda esta misma expresión para
-- INSERT/UPDATE (consistente con el resto del archivo); las bandas globales se
-- siembran con el rol admin (BYPASSRLS), no por la API sujeta a RLS.
DROP POLICY IF EXISTS "performance_bands_tenant_isolation" ON "performance_bands";
CREATE POLICY "performance_bands_tenant_isolation" ON "performance_bands"
  AS PERMISSIVE FOR ALL
  USING (
    org_id IS NULL
    OR org_id::text = current_setting('app.current_org_id', true)
  );

-- ── Políticas sin org_id directo (heredan vía assessments) ──────────────────
DROP POLICY IF EXISTS "responses_tenant_isolation" ON "responses";
CREATE POLICY "responses_tenant_isolation" ON "responses"
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "assessments"
      WHERE "assessments"."id" = "responses"."assessment_id"
        AND "assessments"."org_id"::text = current_setting('app.current_org_id', true)
    )
  );

DROP POLICY IF EXISTS "assessment_results_tenant_isolation" ON "assessment_results";
CREATE POLICY "assessment_results_tenant_isolation" ON "assessment_results"
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "assessments"
      WHERE "assessments"."id" = "assessment_results"."assessment_id"
        AND "assessments"."org_id"::text = current_setting('app.current_org_id', true)
    )
  );

DROP POLICY IF EXISTS "skill_results_tenant_isolation" ON "skill_results";
CREATE POLICY "skill_results_tenant_isolation" ON "skill_results"
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "assessments"
      WHERE "assessments"."id" = "skill_results"."assessment_id"
        AND "assessments"."org_id"::text = current_setting('app.current_org_id', true)
    )
  );

-- ── F2 S0 — ai_analyses + org_benchmark_settings (org_id directo) ────────────
ALTER TABLE "ai_analyses"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_analyses"             FORCE  ROW LEVEL SECURITY;
ALTER TABLE "org_benchmark_settings"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_benchmark_settings"  FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_analyses_tenant_isolation" ON "ai_analyses";
CREATE POLICY "ai_analyses_tenant_isolation" ON "ai_analyses"
  AS PERMISSIVE FOR ALL
  USING (org_id::text = current_setting('app.current_org_id', true));

DROP POLICY IF EXISTS "org_benchmark_settings_tenant_isolation" ON "org_benchmark_settings";
CREATE POLICY "org_benchmark_settings_tenant_isolation" ON "org_benchmark_settings"
  AS PERMISSIVE FOR ALL
  USING (org_id::text = current_setting('app.current_org_id', true));

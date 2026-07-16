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
ALTER TABLE "llm_settings"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "llm_settings"        FORCE  ROW LEVEL SECURITY;

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

-- llm_settings: config de modelo de IA por funcionalidad. org_id NULLABLE igual que
-- performance_bands. Las filas globales (org_id IS NULL) son la config de plataforma:
-- legibles por todos los tenants y resueltas por LlmConfigService SIN contexto de org
-- (como las bandas globales). No contienen PII (solo provider/model). A diferencia de
-- las bandas, ESTAS filas globales sí las escribe la API (panel /configuracion/modelos-ia):
-- con `org_id IS NULL` la expresión USING se hereda como WITH CHECK y evalúa TRUE, así que
-- el rol de la API (sin BYPASSRLS) puede upsertearlas. La autorización real es el role
-- guard platform_admin del endpoint (RLS no es la barrera para config global de plataforma).
DROP POLICY IF EXISTS "llm_settings_tenant_isolation" ON "llm_settings";
CREATE POLICY "llm_settings_tenant_isolation" ON "llm_settings"
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

-- ── F2 S3 — remedial_materials (org_id directo) ──────────────────────────────
ALTER TABLE "remedial_materials"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "remedial_materials"      FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "remedial_materials_tenant_isolation" ON "remedial_materials";
CREATE POLICY "remedial_materials_tenant_isolation" ON "remedial_materials"
  AS PERMISSIVE FOR ALL
  USING (org_id::text = current_setting('app.current_org_id', true));

-- ── F2 S4 — Benchmarking ─────────────────────────────────────────────────────
-- benchmark_access_logs: RLS por org_id (cada org ve solo sus propios accesos).
ALTER TABLE "benchmark_access_logs"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "benchmark_access_logs"   FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "benchmark_access_logs_tenant_isolation" ON "benchmark_access_logs";
CREATE POLICY "benchmark_access_logs_tenant_isolation" ON "benchmark_access_logs"
  AS PERMISSIVE FOR ALL
  USING (org_id::text = current_setting('app.current_org_id', true));

-- ⚠️ benchmark_aggregates: SIN RLS A PROPÓSITO (H7.1). Es el read-model CROSS-TENANT
-- del benchmarking — la única excepción documentada al aislamiento por org. No
-- contiene PII (solo agregados por org). El acceso se protege por guards de rol y
-- el servicio aplica k-anonimato. NO habilitar RLS aquí.

-- ── E21 — Asistente IA Conversacional (org_id directo) ───────────────────────
-- Conversaciones y mensajes del asistente. Datos sensibles (consultas de un
-- directivo sobre desempeño de su colegio) → aislamiento por org_id. El scoping
-- por usuario (cada quien ve solo sus conversaciones) lo aplica el service; RLS
-- es la barrera de tenant a nivel de motor.
ALTER TABLE "assistant_conversations"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assistant_conversations"  FORCE  ROW LEVEL SECURITY;
ALTER TABLE "assistant_messages"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assistant_messages"       FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assistant_conversations_tenant_isolation" ON "assistant_conversations";
CREATE POLICY "assistant_conversations_tenant_isolation" ON "assistant_conversations"
  AS PERMISSIVE FOR ALL
  USING (org_id::text = current_setting('app.current_org_id', true));

DROP POLICY IF EXISTS "assistant_messages_tenant_isolation" ON "assistant_messages";
CREATE POLICY "assistant_messages_tenant_isolation" ON "assistant_messages"
  AS PERMISSIVE FOR ALL
  USING (org_id::text = current_setting('app.current_org_id', true));

-- ── TKT-19 — Propuestas de edición de ítems (org_id directo) ─────────────────
-- Escritura asistida por IA (§8.3: la IA propone, el humano aprueba). Cada org
-- solo ve/aprueba sus propias propuestas; el aplicar al ítem lo hace el service.
ALTER TABLE "item_edit_proposals"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_edit_proposals"      FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "item_edit_proposals_tenant_isolation" ON "item_edit_proposals";
CREATE POLICY "item_edit_proposals_tenant_isolation" ON "item_edit_proposals"
  AS PERMISSIVE FOR ALL
  USING (org_id::text = current_setting('app.current_org_id', true));

-- ── Módulo genérico de almacenamiento de archivos (S3) ───────────────────────
-- `files` tiene org_id NULLABLE: las filas con org_id IS NULL son archivos GLOBALES
-- / de plataforma (ej. el PDF de un instrumento OFICIAL, que no pertenece a ningún
-- colegio), visibles para todos los tenants — mismo criterio que performance_bands /
-- llm_settings. Las filas de tenant se aíslan por org_id. FilesService corre las
-- queries de tenant dentro de withOrgContext(orgId); las globales sin contexto
-- (org_id IS NULL). Con FOR ALL sin WITH CHECK explícito, la expresión USING se
-- hereda para INSERT/UPDATE; el org_id efectivo lo fija el service desde el contexto
-- autorizado (nunca el body), así que el role guard —no el RLS— es la barrera para
-- crear archivos globales.
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "files" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "files_tenant_isolation" ON "files";
CREATE POLICY "files_tenant_isolation" ON "files"
  AS PERMISSIVE FOR ALL
  USING (
    org_id IS NULL
    OR org_id::text = current_setting('app.current_org_id', true)
  );

-- ── Read-model de cohorte (analítica agregada) ──────────────────────────────
-- `assessment_item_stats` / `assessment_skill_stats` no tienen org_id propio: heredan
-- la pertenencia de tenant vía EXISTS sobre assessments, exactamente igual que
-- responses / assessment_results / skill_results (ver más arriba). Se mantiene ese
-- patrón —y no una columna org_id denormalizada— para que la forma de la política sea
-- idéntica a la de sus tablas hermanas de resultados y no haya dos criterios conviviendo.
--
-- Nota: NO confundir con benchmark_aggregates, que es la única tabla SIN RLS del
-- proyecto (se lee cross-tenant a propósito). Estas dos SÍ son datos de un colegio.
--
-- Ver docs/plan-analitica-agregada-informes-oficiales.md §3.5.
ALTER TABLE "assessment_item_stats"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_item_stats"  FORCE  ROW LEVEL SECURITY;
ALTER TABLE "assessment_skill_stats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_skill_stats" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assessment_item_stats_tenant_isolation" ON "assessment_item_stats";
CREATE POLICY "assessment_item_stats_tenant_isolation" ON "assessment_item_stats"
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "assessments"
      WHERE "assessments"."id" = "assessment_item_stats"."assessment_id"
        AND "assessments"."org_id"::text = current_setting('app.current_org_id', true)
    )
  );

DROP POLICY IF EXISTS "assessment_skill_stats_tenant_isolation" ON "assessment_skill_stats";
CREATE POLICY "assessment_skill_stats_tenant_isolation" ON "assessment_skill_stats"
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "assessments"
      WHERE "assessments"."id" = "assessment_skill_stats"."assessment_id"
        AND "assessments"."org_id"::text = current_setting('app.current_org_id', true)
    )
  );

CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_filter" jsonb,
	"record_count" integer,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "is_anonymized" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ================================================================
-- H19.4 — Row Level Security (aislamiento multi-tenant Ley 19.628)
-- ================================================================
-- Bloque agregado manualmente sobre la migración generada por drizzle-kit.
-- current_setting(..., true) retorna '' si la variable no está definida (no
-- lanza error). Si app.current_org_id no está fijada, la condición es falsa
-- → 0 filas devueltas (safe default). El wrapper withOrgContext() de
-- packages/db fija esta variable por transacción.
--
-- ADVERTENCIA: el usuario de BD del API (soe_app) NO debe tener BYPASSRLS.
-- Ver "Fuera de scope" en docs/Srpints/H19.4-privacidad-ley-19628.md.

-- Tablas con org_id directo
ALTER TABLE "students" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assessments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Tablas sin org_id directo (heredan la pertenencia de tenant vía assessments)
ALTER TABLE "responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assessment_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "skill_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "students_tenant_isolation" ON "students"
  AS PERMISSIVE FOR ALL
  USING (org_id::text = current_setting('app.current_org_id', true));--> statement-breakpoint

CREATE POLICY "assessments_tenant_isolation" ON "assessments"
  AS PERMISSIVE FOR ALL
  USING (org_id::text = current_setting('app.current_org_id', true));--> statement-breakpoint

CREATE POLICY "import_jobs_tenant_isolation" ON "import_jobs"
  AS PERMISSIVE FOR ALL
  USING (org_id::text = current_setting('app.current_org_id', true));--> statement-breakpoint

CREATE POLICY "responses_tenant_isolation" ON "responses"
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "assessments"
      WHERE "assessments"."id" = "responses"."assessment_id"
        AND "assessments"."org_id"::text = current_setting('app.current_org_id', true)
    )
  );--> statement-breakpoint

CREATE POLICY "assessment_results_tenant_isolation" ON "assessment_results"
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "assessments"
      WHERE "assessments"."id" = "assessment_results"."assessment_id"
        AND "assessments"."org_id"::text = current_setting('app.current_org_id', true)
    )
  );--> statement-breakpoint

CREATE POLICY "skill_results_tenant_isolation" ON "skill_results"
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "assessments"
      WHERE "assessments"."id" = "skill_results"."assessment_id"
        AND "assessments"."org_id"::text = current_setting('app.current_org_id', true)
    )
  );
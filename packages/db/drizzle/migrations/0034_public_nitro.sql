CREATE TYPE "public"."process_kind" AS ENUM('dia', 'simce_ensayo', 'paes_ensayo', 'evaluacion_interna', 'cambridge_mock', 'custom');--> statement-breakpoint
CREATE TYPE "public"."process_status" AS ENUM('planned', 'in_progress', 'loading', 'closed', 'archived');--> statement-breakpoint
CREATE TABLE "measurement_processes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" "process_kind" NOT NULL,
	"period" "instrument_application_period",
	"taxonomy_id" uuid,
	"status" "process_status" DEFAULT 'planned' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"expected_scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_id" uuid,
	"notes" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_processes_org_slug_unique" UNIQUE("org_id","slug")
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "process_id" uuid;--> statement-breakpoint
ALTER TABLE "measurement_processes" ADD CONSTRAINT "measurement_processes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_processes" ADD CONSTRAINT "measurement_processes_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_processes" ADD CONSTRAINT "measurement_processes_taxonomy_id_taxonomies_id_fk" FOREIGN KEY ("taxonomy_id") REFERENCES "public"."taxonomies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_processes" ADD CONSTRAINT "measurement_processes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_measurement_processes_org_year" ON "measurement_processes" USING btree ("org_id","academic_year_id");--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_process_id_measurement_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."measurement_processes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_assessments_process" ON "assessments" USING btree ("process_id");
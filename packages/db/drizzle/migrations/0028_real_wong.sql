CREATE TYPE "public"."section_role" AS ENUM('core', 'elective');--> statement-breakpoint
CREATE TABLE "assessment_form_students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"assessment_form_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_form_students_form_student_uq" UNIQUE("assessment_form_id","student_id")
);
--> statement-breakpoint
ALTER TABLE "instrument_sections" ADD COLUMN "role" "section_role" DEFAULT 'core' NOT NULL;--> statement-breakpoint
ALTER TABLE "instrument_sections" ADD COLUMN "elective_group" text;--> statement-breakpoint
ALTER TABLE "instrument_sections" ADD COLUMN "elective_key" text;--> statement-breakpoint
-- `org_id` en tres pasos para no fallar si la tabla ya tiene filas: se agrega nullable,
-- se rellena desde el assessment dueño y recién entonces se marca NOT NULL.
ALTER TABLE "assessment_forms" ADD COLUMN "org_id" uuid;--> statement-breakpoint
UPDATE "assessment_forms" f SET "org_id" = a."org_id"
  FROM "assessments" a WHERE a."id" = f."assessment_id" AND f."org_id" IS NULL;--> statement-breakpoint
DELETE FROM "assessment_forms" WHERE "org_id" IS NULL;--> statement-breakpoint
ALTER TABLE "assessment_forms" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_forms" ADD COLUMN "section_ids" uuid[];--> statement-breakpoint
ALTER TABLE "assessment_form_students" ADD CONSTRAINT "assessment_form_students_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_form_students" ADD CONSTRAINT "assessment_form_students_assessment_form_id_assessment_forms_id_fk" FOREIGN KEY ("assessment_form_id") REFERENCES "public"."assessment_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_form_students" ADD CONSTRAINT "assessment_form_students_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_forms" ADD CONSTRAINT "assessment_forms_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Integridad del rol de sección: una sección electiva SIEMPRE declara a qué grupo pertenece
-- y cuál de las alternativas es. Va como CHECK y no como validación de Service porque es una
-- restricción de integridad (CLAUDE.md §5.4).
ALTER TABLE "instrument_sections" ADD CONSTRAINT "instrument_sections_elective_ck" CHECK (
  ("role" = 'core'     AND "elective_group" IS NULL     AND "elective_key" IS NULL) OR
  ("role" = 'elective' AND "elective_group" IS NOT NULL AND "elective_key" IS NOT NULL)
);--> statement-breakpoint
-- Dentro de un instrumento, una alternativa de un grupo electivo no puede repetirse.
CREATE UNIQUE INDEX "instrument_sections_elective_uq"
  ON "instrument_sections" ("instrument_id", "elective_group", "elective_key")
  WHERE "role" = 'elective';

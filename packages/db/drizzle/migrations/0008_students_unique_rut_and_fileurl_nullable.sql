ALTER TABLE "import_jobs" ALTER COLUMN "file_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_org_rut_unique" UNIQUE("org_id","rut");
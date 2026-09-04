CREATE TYPE "public"."mark_state" AS ENUM('marked', 'blank', 'multiple', 'ambiguous');--> statement-breakpoint
CREATE TYPE "public"."sheet_scan_batch_status" AS ENUM('pending', 'processing', 'needs_review', 'confirmed', 'failed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."sheet_scan_state" AS ENUM('read', 'quality_rejected', 'identity_unresolved', 'superseded');--> statement-breakpoint
CREATE TABLE "printed_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"print_run_id" uuid NOT NULL,
	"student_id" uuid,
	"sequence" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "printed_sheets_run_sequence_uq" UNIQUE("print_run_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "sheet_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"spec" jsonb NOT NULL,
	"spec_hash" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_layouts_org_instrument_version_uq" UNIQUE("org_id","instrument_id","version")
);
--> statement-breakpoint
CREATE TABLE "sheet_print_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"layout_id" uuid NOT NULL,
	"class_group_id" uuid,
	"assessment_id" uuid,
	"assessment_form_id" uuid,
	"spare_count" integer DEFAULT 0 NOT NULL,
	"sheet_count" integer NOT NULL,
	"pdf_file_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_scan_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"print_run_id" uuid NOT NULL,
	"status" "sheet_scan_batch_status" DEFAULT 'pending' NOT NULL,
	"capture_profile" jsonb NOT NULL,
	"source_file_ids" jsonb NOT NULL,
	"pages_total" integer,
	"pages_read" integer DEFAULT 0 NOT NULL,
	"review_pending" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"import_job_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_scan_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"field_id" text NOT NULL,
	"printed_number" text NOT NULL,
	"state" "mark_state" NOT NULL,
	"value" text,
	"fill" numeric(4, 3) NOT NULL,
	"threshold" numeric(4, 3) NOT NULL,
	"margin" numeric(6, 3) NOT NULL,
	"crop_file_id" uuid,
	"reviewed_value" text,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp,
	CONSTRAINT "sheet_scan_marks_scan_field_uq" UNIQUE("scan_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "sheet_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"printed_sheet_id" uuid,
	"page_index" integer NOT NULL,
	"source_file_id" uuid,
	"source_page_index" integer,
	"image_hash" text NOT NULL,
	"state" "sheet_scan_state" NOT NULL,
	"quality" jsonb NOT NULL,
	"resolved_student_id" uuid,
	"identity_confidence" numeric(4, 3),
	"identity_evidence" jsonb,
	"thumb_file_id" uuid,
	"supersedes_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_scans_sheet_page_hash_uq" UNIQUE("printed_sheet_id","page_index","image_hash")
);
--> statement-breakpoint
ALTER TABLE "printed_sheets" ADD CONSTRAINT "printed_sheets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printed_sheets" ADD CONSTRAINT "printed_sheets_print_run_id_sheet_print_runs_id_fk" FOREIGN KEY ("print_run_id") REFERENCES "public"."sheet_print_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printed_sheets" ADD CONSTRAINT "printed_sheets_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_layouts" ADD CONSTRAINT "sheet_layouts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_layouts" ADD CONSTRAINT "sheet_layouts_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_layouts" ADD CONSTRAINT "sheet_layouts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_print_runs" ADD CONSTRAINT "sheet_print_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_print_runs" ADD CONSTRAINT "sheet_print_runs_layout_id_sheet_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."sheet_layouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_print_runs" ADD CONSTRAINT "sheet_print_runs_class_group_id_class_groups_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_print_runs" ADD CONSTRAINT "sheet_print_runs_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_print_runs" ADD CONSTRAINT "sheet_print_runs_assessment_form_id_assessment_forms_id_fk" FOREIGN KEY ("assessment_form_id") REFERENCES "public"."assessment_forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_print_runs" ADD CONSTRAINT "sheet_print_runs_pdf_file_id_files_id_fk" FOREIGN KEY ("pdf_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_print_runs" ADD CONSTRAINT "sheet_print_runs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_scan_batches" ADD CONSTRAINT "sheet_scan_batches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_scan_batches" ADD CONSTRAINT "sheet_scan_batches_print_run_id_sheet_print_runs_id_fk" FOREIGN KEY ("print_run_id") REFERENCES "public"."sheet_print_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_scan_batches" ADD CONSTRAINT "sheet_scan_batches_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_scan_batches" ADD CONSTRAINT "sheet_scan_batches_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_scan_marks" ADD CONSTRAINT "sheet_scan_marks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_scan_marks" ADD CONSTRAINT "sheet_scan_marks_scan_id_sheet_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."sheet_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_scan_marks" ADD CONSTRAINT "sheet_scan_marks_crop_file_id_files_id_fk" FOREIGN KEY ("crop_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_scan_marks" ADD CONSTRAINT "sheet_scan_marks_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_scans" ADD CONSTRAINT "sheet_scans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_scans" ADD CONSTRAINT "sheet_scans_batch_id_sheet_scan_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."sheet_scan_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_scans" ADD CONSTRAINT "sheet_scans_printed_sheet_id_printed_sheets_id_fk" FOREIGN KEY ("printed_sheet_id") REFERENCES "public"."printed_sheets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_scans" ADD CONSTRAINT "sheet_scans_source_file_id_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_scans" ADD CONSTRAINT "sheet_scans_resolved_student_id_students_id_fk" FOREIGN KEY ("resolved_student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_scans" ADD CONSTRAINT "sheet_scans_thumb_file_id_files_id_fk" FOREIGN KEY ("thumb_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "printed_sheets_run_idx" ON "printed_sheets" USING btree ("org_id","print_run_id");--> statement-breakpoint
CREATE INDEX "sheet_layouts_hash_idx" ON "sheet_layouts" USING btree ("spec_hash");--> statement-breakpoint
CREATE INDEX "sheet_print_runs_form_idx" ON "sheet_print_runs" USING btree ("assessment_form_id");--> statement-breakpoint
CREATE INDEX "sheet_scan_marks_review_idx" ON "sheet_scan_marks" USING btree ("org_id","scan_id","state");--> statement-breakpoint
CREATE INDEX "sheet_scans_batch_idx" ON "sheet_scans" USING btree ("org_id","batch_id");
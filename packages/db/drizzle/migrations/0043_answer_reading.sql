CREATE TYPE "public"."answer_reading_consent_scope" AS ENUM('org_internal', 'platform_eval');--> statement-breakpoint
CREATE TYPE "public"."answer_reading_label_source" AS ENUM('review_reading', 'review_grading', 'double_annotation', 'import');--> statement-breakpoint
CREATE TYPE "public"."answer_reading_mode" AS ENUM('primary', 'shadow', 'tiebreak');--> statement-breakpoint
CREATE TYPE "public"."answer_reading_run_status" AS ENUM('pending', 'running', 'waiting_provider', 'completed', 'failed', 'budget_exceeded');--> statement-breakpoint
CREATE TYPE "public"."answer_reading_run_trigger" AS ENUM('scan_processed', 'manual_rerun', 'route_change', 'backfill');--> statement-breakpoint
CREATE TYPE "public"."answer_reading_split" AS ENUM('train', 'validation', 'test');--> statement-breakpoint
CREATE TYPE "public"."answer_review_action" AS ENUM('accept', 'edit', 'illegible', 'blank', 'crossed_out', 'mark_correct', 'mark_incorrect', 'undo');--> statement-breakpoint
CREATE TYPE "public"."answer_review_mode" AS ENUM('reading', 'grading');--> statement-breakpoint
CREATE TYPE "public"."reading_outcome" AS ENUM('auto_accepted', 'auto_blank', 'needs_review', 'not_read');--> statement-breakpoint
CREATE TYPE "public"."reading_route_level" AS ENUM('item', 'instrument', 'format_subject_grade', 'format_subject', 'format', 'default');--> statement-breakpoint
CREATE TYPE "public"."reading_route_status" AS ENUM('shadow', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."reading_state" AS ENUM('answered', 'blank', 'illegible', 'crossed_out_only', 'multiple_answers');--> statement-breakpoint
CREATE TYPE "public"."scoring_outcome" AS ENUM('correct', 'incorrect', 'partial', 'undecidable');--> statement-breakpoint
CREATE TYPE "public"."transcription_status" AS ENUM('ok', 'invalid_output', 'refused', 'truncated', 'error', 'timeout');--> statement-breakpoint
CREATE TABLE "answer_reading_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"mark_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"assessment_id" uuid,
	"student_id" uuid,
	"response_id" uuid,
	"outcome" "reading_outcome" NOT NULL,
	"canonical" text,
	"value" jsonb,
	"scoring_outcome" "scoring_outcome",
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_mode" "answer_review_mode",
	"route_id" uuid,
	"route_version" integer,
	"policy_id" text NOT NULL,
	"policy_version" integer NOT NULL,
	"used_reading_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"superseded_by_id" uuid,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answer_reading_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"batch_id" uuid,
	"assessment_id" uuid,
	"trigger" "answer_reading_run_trigger" NOT NULL,
	"status" "answer_reading_run_status" DEFAULT 'pending' NOT NULL,
	"crops_total" integer DEFAULT 0 NOT NULL,
	"crops_done" integer DEFAULT 0 NOT NULL,
	"auto_accepted" integer DEFAULT 0 NOT NULL,
	"needs_review" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"failure_reason" text,
	"created_by_id" uuid,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answer_reading_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"decision_id" uuid,
	"review_id" uuid,
	"item_id" uuid NOT NULL,
	"format_kind" text NOT NULL,
	"subject_id" uuid,
	"grade_id" uuid,
	"crop_file_id" uuid NOT NULL,
	"crop_sha256" text,
	"crop_profile_id" text,
	"label_state" "reading_state" NOT NULL,
	"label_literal" text NOT NULL,
	"label_canonical" text,
	"label_source" "answer_reading_label_source" NOT NULL,
	"annotator_count" integer DEFAULT 1 NOT NULL,
	"split" "answer_reading_split" NOT NULL,
	"consent_scope" "answer_reading_consent_scope" DEFAULT 'org_internal' NOT NULL,
	"needs_normalizer_case" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answer_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"mark_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"crop_file_id" uuid,
	"crop_sha256" text,
	"crop_profile_id" text NOT NULL,
	"response_format" jsonb NOT NULL,
	"reading_key" text NOT NULL,
	"mode" "answer_reading_mode" NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"route_id" uuid,
	"route_version" integer,
	"reader_key" text NOT NULL,
	"transcriber_id" text NOT NULL,
	"provider" text NOT NULL,
	"family" text NOT NULL,
	"model" text NOT NULL,
	"provider_model" text,
	"prompt_ref" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"output_schema_id" text NOT NULL,
	"params" jsonb NOT NULL,
	"status" "transcription_status" NOT NULL,
	"output" jsonb,
	"reading_state" "reading_state",
	"literal" text,
	"confidence" numeric(4, 3),
	"raw_text" text,
	"normalized" jsonb,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"image_tokens" integer,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer,
	"error_code" text,
	"provider_batch_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "answer_readings_attempt_positive" CHECK ("answer_readings"."attempt" >= 1)
);
--> statement-breakpoint
CREATE TABLE "answer_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"mode" "answer_review_mode" NOT NULL,
	"action" "answer_review_action" NOT NULL,
	"edited_literal" text,
	"resulting_canonical" text,
	"resulting_value" jsonb,
	"reason" text,
	"group_operation_id" uuid,
	"group_size" integer DEFAULT 1 NOT NULL,
	"superseded_by_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "answer_reviews_group_size_positive" CHECK ("answer_reviews"."group_size" >= 1)
);
--> statement-breakpoint
CREATE TABLE "reading_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"status" "reading_route_status" DEFAULT 'shadow' NOT NULL,
	"level" "reading_route_level" NOT NULL,
	"item_id" uuid,
	"instrument_id" uuid,
	"format_kind" text,
	"subject_id" uuid,
	"grade_id" uuid,
	"readers" jsonb NOT NULL,
	"fallback_readers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shadow_readers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shadow_sample_rate" numeric(4, 3) DEFAULT '0' NOT NULL,
	"policy" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"notes" text,
	"created_by_id" uuid,
	"activated_by_id" uuid,
	"activated_at" timestamp,
	"retired_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reading_routes_scope_matches_level" CHECK (CASE "reading_routes"."level"
        WHEN 'item' THEN "reading_routes"."item_id" IS NOT NULL AND "reading_routes"."instrument_id" IS NULL AND "reading_routes"."format_kind" IS NULL AND "reading_routes"."subject_id" IS NULL AND "reading_routes"."grade_id" IS NULL
        WHEN 'instrument' THEN "reading_routes"."item_id" IS NULL AND "reading_routes"."instrument_id" IS NOT NULL AND "reading_routes"."format_kind" IS NULL AND "reading_routes"."subject_id" IS NULL AND "reading_routes"."grade_id" IS NULL
        WHEN 'format_subject_grade' THEN "reading_routes"."item_id" IS NULL AND "reading_routes"."instrument_id" IS NULL AND "reading_routes"."format_kind" IS NOT NULL AND "reading_routes"."subject_id" IS NOT NULL AND "reading_routes"."grade_id" IS NOT NULL
        WHEN 'format_subject' THEN "reading_routes"."item_id" IS NULL AND "reading_routes"."instrument_id" IS NULL AND "reading_routes"."format_kind" IS NOT NULL AND "reading_routes"."subject_id" IS NOT NULL AND "reading_routes"."grade_id" IS NULL
        WHEN 'format' THEN "reading_routes"."item_id" IS NULL AND "reading_routes"."instrument_id" IS NULL AND "reading_routes"."format_kind" IS NOT NULL AND "reading_routes"."subject_id" IS NULL AND "reading_routes"."grade_id" IS NULL
        WHEN 'default' THEN "reading_routes"."item_id" IS NULL AND "reading_routes"."instrument_id" IS NULL AND "reading_routes"."format_kind" IS NULL AND "reading_routes"."subject_id" IS NULL AND "reading_routes"."grade_id" IS NULL
      END),
	CONSTRAINT "reading_routes_shadow_sample_rate_range" CHECK ("reading_routes"."shadow_sample_rate" >= 0 AND "reading_routes"."shadow_sample_rate" <= 1),
	CONSTRAINT "reading_routes_version_positive" CHECK ("reading_routes"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "answer_reading_decisions" ADD CONSTRAINT "answer_reading_decisions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_decisions" ADD CONSTRAINT "answer_reading_decisions_run_id_answer_reading_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."answer_reading_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_decisions" ADD CONSTRAINT "answer_reading_decisions_mark_id_sheet_scan_marks_id_fk" FOREIGN KEY ("mark_id") REFERENCES "public"."sheet_scan_marks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_decisions" ADD CONSTRAINT "answer_reading_decisions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_decisions" ADD CONSTRAINT "answer_reading_decisions_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_decisions" ADD CONSTRAINT "answer_reading_decisions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_decisions" ADD CONSTRAINT "answer_reading_decisions_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_decisions" ADD CONSTRAINT "answer_reading_decisions_route_id_reading_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."reading_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_runs" ADD CONSTRAINT "answer_reading_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_runs" ADD CONSTRAINT "answer_reading_runs_batch_id_sheet_scan_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."sheet_scan_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_runs" ADD CONSTRAINT "answer_reading_runs_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_runs" ADD CONSTRAINT "answer_reading_runs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_samples" ADD CONSTRAINT "answer_reading_samples_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_samples" ADD CONSTRAINT "answer_reading_samples_decision_id_answer_reading_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."answer_reading_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_samples" ADD CONSTRAINT "answer_reading_samples_review_id_answer_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."answer_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_samples" ADD CONSTRAINT "answer_reading_samples_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_samples" ADD CONSTRAINT "answer_reading_samples_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_samples" ADD CONSTRAINT "answer_reading_samples_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reading_samples" ADD CONSTRAINT "answer_reading_samples_crop_file_id_files_id_fk" FOREIGN KEY ("crop_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_readings" ADD CONSTRAINT "answer_readings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_readings" ADD CONSTRAINT "answer_readings_run_id_answer_reading_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."answer_reading_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_readings" ADD CONSTRAINT "answer_readings_mark_id_sheet_scan_marks_id_fk" FOREIGN KEY ("mark_id") REFERENCES "public"."sheet_scan_marks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_readings" ADD CONSTRAINT "answer_readings_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_readings" ADD CONSTRAINT "answer_readings_crop_file_id_files_id_fk" FOREIGN KEY ("crop_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_readings" ADD CONSTRAINT "answer_readings_route_id_reading_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."reading_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reviews" ADD CONSTRAINT "answer_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reviews" ADD CONSTRAINT "answer_reviews_decision_id_answer_reading_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."answer_reading_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reviews" ADD CONSTRAINT "answer_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_reviews" ADD CONSTRAINT "answer_reviews_superseded_by_id_answer_reviews_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."answer_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_routes" ADD CONSTRAINT "reading_routes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_routes" ADD CONSTRAINT "reading_routes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_routes" ADD CONSTRAINT "reading_routes_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_routes" ADD CONSTRAINT "reading_routes_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_routes" ADD CONSTRAINT "reading_routes_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_routes" ADD CONSTRAINT "reading_routes_supersedes_id_reading_routes_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."reading_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_routes" ADD CONSTRAINT "reading_routes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_routes" ADD CONSTRAINT "reading_routes_activated_by_id_users_id_fk" FOREIGN KEY ("activated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_reading_decisions_current_mark_uq" ON "answer_reading_decisions" USING btree ("org_id","mark_id") WHERE "answer_reading_decisions"."superseded_by_id" IS NULL;--> statement-breakpoint
CREATE INDEX "answer_reading_decisions_queue_idx" ON "answer_reading_decisions" USING btree ("org_id","assessment_id","outcome","item_id") WHERE "answer_reading_decisions"."superseded_by_id" IS NULL;--> statement-breakpoint
CREATE INDEX "answer_reading_decisions_group_idx" ON "answer_reading_decisions" USING btree ("org_id","item_id","canonical") WHERE "answer_reading_decisions"."superseded_by_id" IS NULL;--> statement-breakpoint
CREATE INDEX "answer_reading_decisions_run_idx" ON "answer_reading_decisions" USING btree ("org_id","run_id");--> statement-breakpoint
CREATE INDEX "answer_reading_decisions_response_idx" ON "answer_reading_decisions" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "answer_reading_runs_batch_idx" ON "answer_reading_runs" USING btree ("org_id","batch_id");--> statement-breakpoint
CREATE INDEX "answer_reading_runs_assessment_idx" ON "answer_reading_runs" USING btree ("org_id","assessment_id","created_at");--> statement-breakpoint
CREATE INDEX "answer_reading_runs_status_idx" ON "answer_reading_runs" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "answer_reading_samples_split_format_idx" ON "answer_reading_samples" USING btree ("org_id","split","format_kind") WHERE "answer_reading_samples"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_reading_samples_review_uq" ON "answer_reading_samples" USING btree ("org_id","review_id") WHERE "answer_reading_samples"."review_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "answer_reading_samples_normalizer_idx" ON "answer_reading_samples" USING btree ("org_id","format_kind") WHERE "answer_reading_samples"."needs_normalizer_case" AND "answer_reading_samples"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_readings_key_reader_mode_attempt_uq" ON "answer_readings" USING btree ("org_id","reading_key","reader_key","mode","attempt");--> statement-breakpoint
CREATE INDEX "answer_readings_run_idx" ON "answer_readings" USING btree ("org_id","run_id");--> statement-breakpoint
CREATE INDEX "answer_readings_mark_idx" ON "answer_readings" USING btree ("org_id","mark_id");--> statement-breakpoint
CREATE INDEX "answer_readings_prompt_created_idx" ON "answer_readings" USING btree ("org_id","prompt_ref","created_at");--> statement-breakpoint
CREATE INDEX "answer_reviews_decision_idx" ON "answer_reviews" USING btree ("org_id","decision_id");--> statement-breakpoint
CREATE INDEX "answer_reviews_group_operation_idx" ON "answer_reviews" USING btree ("org_id","group_operation_id") WHERE "answer_reviews"."group_operation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "answer_reviews_reviewer_created_idx" ON "answer_reviews" USING btree ("org_id","reviewer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reading_routes_active_scope_uq" ON "reading_routes" USING btree (coalesce("org_id", '00000000-0000-0000-0000-000000000000'::uuid),"level",coalesce("item_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("instrument_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("format_kind", ''),coalesce("subject_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("grade_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "reading_routes"."status" = 'active';--> statement-breakpoint
CREATE INDEX "reading_routes_item_idx" ON "reading_routes" USING btree ("item_id","org_id") WHERE "reading_routes"."level" = 'item' AND "reading_routes"."status" <> 'retired';--> statement-breakpoint
CREATE INDEX "reading_routes_instrument_idx" ON "reading_routes" USING btree ("instrument_id","org_id") WHERE "reading_routes"."level" = 'instrument' AND "reading_routes"."status" <> 'retired';--> statement-breakpoint
CREATE INDEX "reading_routes_format_idx" ON "reading_routes" USING btree ("format_kind","subject_id","grade_id","org_id") WHERE "reading_routes"."level" IN ('format_subject_grade', 'format_subject', 'format') AND "reading_routes"."status" <> 'retired';--> statement-breakpoint
CREATE INDEX "reading_routes_default_idx" ON "reading_routes" USING btree ("org_id") WHERE "reading_routes"."level" = 'default' AND "reading_routes"."status" <> 'retired';
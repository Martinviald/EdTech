CREATE TYPE "public"."assessment_mode" AS ENUM('paper', 'digital', 'oral', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."assessment_status" AS ENUM('scheduled', 'in_progress', 'processing', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'transferred', 'graduated', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('M', 'F', 'X', 'unspecified');--> statement-breakpoint
CREATE TYPE "public"."grading_scale_type" AS ENUM('linear_chilean', 'percentage', 'paes_scaled', 'irt_based', 'custom');--> statement-breakpoint
CREATE TYPE "public"."import_job_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."import_job_type" AS ENUM('answer_sheet_csv', 'dia_official', 'gradecam_csv', 'zipgrade_csv', 'aptus', 'student_roster');--> statement-breakpoint
CREATE TYPE "public"."instrument_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."instrument_type" AS ENUM('dia', 'simce', 'paes', 'cambridge_mock', 'aptus', 'desafio', 'pal', 'custom');--> statement-breakpoint
CREATE TYPE "public"."item_source" AS ENUM('official', 'ai_generated', 'custom', 'imported');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('draft', 'review', 'published', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."item_tag_type" AS ENUM('primary', 'secondary');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('multiple_choice', 'true_false', 'open_ended', 'oral_reading', 'oral_expression', 'writing', 'listening', 'matching', 'ordering', 'gap_fill');--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('platform', 'foundation', 'school');--> statement-breakpoint
CREATE TYPE "public"."performance_level" AS ENUM('insufficient', 'elementary', 'adequate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."rubric_type" AS ENUM('analytic', 'holistic');--> statement-breakpoint
CREATE TYPE "public"."school_dependence" AS ENUM('municipal', 'particular_pagado', 'particular_subvencionado', 'delegada');--> statement-breakpoint
CREATE TYPE "public"."scored_by" AS ENUM('auto', 'ai', 'human');--> statement-breakpoint
CREATE TYPE "public"."section_type" AS ENUM('multiple_choice', 'open_ended', 'oral_reading', 'oral_expression', 'writing', 'listening', 'matching', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."sso_provider" AS ENUM('google', 'microsoft');--> statement-breakpoint
CREATE TYPE "public"."tagged_by" AS ENUM('human', 'ai');--> statement-breakpoint
CREATE TYPE "public"."taxonomy_mapping_type" AS ENUM('equivalent', 'subset', 'related');--> statement-breakpoint
CREATE TYPE "public"."taxonomy_node_type" AS ENUM('domain', 'subdomain', 'axis', 'learning_objective', 'skill', 'content', 'text_type', 'performance_level', 'descriptor', 'criterion', 'paper');--> statement-breakpoint
CREATE TYPE "public"."taxonomy_type" AS ENUM('mineduc', 'simce', 'paes', 'dia', 'cambridge', 'aptus', 'desafio', 'custom');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('platform_admin', 'foundation_director', 'school_admin', 'academic_director', 'cycle_director', 'dept_head', 'coordinator', 'teacher', 'homeroom_teacher', 'eval_coordinator', 'guardian');--> statement-breakpoint
CREATE TABLE "academic_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"start_date" date,
	"end_date" date,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "org_type" NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"rbd" text,
	"commune" text,
	"region" text,
	"dependence" "school_dependence",
	"config" jsonb DEFAULT '{}'::jsonb,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"grade_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"code" text NOT NULL,
	"cycle" integer NOT NULL,
	"order" integer NOT NULL,
	CONSTRAINT "grades_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "subject_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_group_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subject_classes_class_group_id_subject_id_academic_year_id_unique" UNIQUE("class_group_id","subject_id","academic_year_id")
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"code" text NOT NULL,
	"mineduc_code" text,
	CONSTRAINT "subjects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "org_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"org_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"scope" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"email" text,
	"invited_by_user_id" uuid,
	"invited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_memberships_user_id_org_id_role_unique" UNIQUE("user_id","org_id","role")
);
--> statement-breakpoint
CREATE TABLE "teacher_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_class_id" uuid NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_assignments_user_id_subject_class_id_unique" UNIQUE("user_id","subject_class_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"provider" "sso_provider" NOT NULL,
	"provider_id" text NOT NULL,
	"last_login_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "student_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"status" "enrollment_status" DEFAULT 'active' NOT NULL,
	"enrolled_at" date DEFAULT now() NOT NULL,
	"withdrawn_at" date,
	CONSTRAINT "student_enrollments_student_id_academic_year_id_unique" UNIQUE("student_id","academic_year_id")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"rut" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"birth_date" date,
	"gender" "gender" DEFAULT 'unspecified',
	"profile" jsonb,
	"is_anonymized" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "students_org_rut_unique" UNIQUE("org_id","rut")
);
--> statement-breakpoint
CREATE TABLE "taxonomies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "taxonomy_type" NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"version" text,
	"is_official" boolean DEFAULT false NOT NULL,
	"org_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taxonomy_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"mapping_type" "taxonomy_mapping_type" NOT NULL,
	"confidence" numeric(3, 2) DEFAULT '1.00',
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "taxonomy_mappings_source_node_id_target_node_id_unique" UNIQUE("source_node_id","target_node_id")
);
--> statement-breakpoint
CREATE TABLE "taxonomy_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"taxonomy_id" uuid NOT NULL,
	"parent_id" uuid,
	"type" "taxonomy_node_type" NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"description" text,
	"grade_id" uuid,
	"subject_id" uuid,
	"order" integer DEFAULT 0 NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grading_scales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"name" text NOT NULL,
	"type" "grading_scale_type" NOT NULL,
	"min_grade" numeric(5, 2) DEFAULT '1.00' NOT NULL,
	"max_grade" numeric(5, 2) DEFAULT '7.00' NOT NULL,
	"passing_grade" numeric(5, 2) DEFAULT '4.00' NOT NULL,
	"passing_threshold" numeric(3, 2) DEFAULT '0.60' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instrument_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "section_type" NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"max_points" numeric(7, 2),
	"time_limit_min" integer,
	"instructions" text,
	"config" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"taxonomy_id" uuid,
	"name" text NOT NULL,
	"short_name" text,
	"type" "instrument_type" NOT NULL,
	"subject_id" uuid,
	"grade_id" uuid,
	"year" integer,
	"version" text,
	"is_official" boolean DEFAULT false NOT NULL,
	"status" "instrument_status" DEFAULT 'draft' NOT NULL,
	"grading_scale_id" uuid,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_by_id" uuid,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_taxonomy_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"tag_type" "item_tag_type" DEFAULT 'primary' NOT NULL,
	"confidence" numeric(3, 2) DEFAULT '1.00',
	"tagged_by" "tagged_by" DEFAULT 'human' NOT NULL,
	"tagged_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "item_taxonomy_tags_item_id_node_id_unique" UNIQUE("item_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "item_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"irt_params" jsonb,
	"changed_by_id" uuid,
	"change_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "item_versions_item_id_version_unique" UNIQUE("item_id","version")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"instrument_id" uuid,
	"section_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"type" "item_type" NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scoring_config" jsonb DEFAULT '{}'::jsonb,
	"irt_params" jsonb DEFAULT '{}'::jsonb,
	"status" "item_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source" "item_source" DEFAULT 'custom' NOT NULL,
	"created_by_id" uuid,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rubric_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"max_points" numeric(5, 2) NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"taxonomy_node_id" uuid
);
--> statement-breakpoint
CREATE TABLE "rubric_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"criterion_id" uuid NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"descriptor" text NOT NULL,
	"examples" text[],
	CONSTRAINT "rubric_levels_criterion_id_score_unique" UNIQUE("criterion_id","score")
);
--> statement-breakpoint
CREATE TABLE "rubrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"name" text NOT NULL,
	"type" "rubric_type" DEFAULT 'analytic' NOT NULL,
	"subject_id" uuid,
	"created_by_id" uuid,
	"is_shared" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_course_assignments" (
	"assessment_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	CONSTRAINT "assessment_course_assignments_assessment_id_class_group_id_pk" PRIMARY KEY("assessment_id","class_group_id")
);
--> statement-breakpoint
CREATE TABLE "assessment_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"item_order" uuid[],
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"name" text,
	"administered_by_id" uuid,
	"mode" "assessment_mode" DEFAULT 'paper' NOT NULL,
	"status" "assessment_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_for" timestamp,
	"administered_at" timestamp,
	"config" jsonb DEFAULT '{}'::jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"assessment_id" uuid,
	"type" "import_job_type" NOT NULL,
	"status" "import_job_status" DEFAULT 'pending' NOT NULL,
	"file_url" text,
	"mapping_config" jsonb DEFAULT '{}'::jsonb,
	"result" jsonb,
	"error_log" jsonb,
	"created_by_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ai_grading_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"model" text,
	"prompt_version" text,
	"input" jsonb,
	"output" jsonb,
	"score" numeric(7, 2),
	"confidence" numeric(3, 2),
	"justification" text,
	"cost_usd" numeric(10, 6),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"form_id" uuid,
	"student_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_correct" boolean,
	"raw_score" numeric(7, 2),
	"max_score" numeric(7, 2) NOT NULL,
	"ai_score" jsonb,
	"human_score" jsonb,
	"final_score" numeric(7, 2),
	"scored_by" "scored_by",
	"scored_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "responses_assessment_id_student_id_item_id_unique" UNIQUE("assessment_id","student_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "assessment_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"total_score" numeric(7, 2),
	"max_score" numeric(7, 2),
	"percentage" numeric(5, 2),
	"grade" numeric(5, 2),
	"performance_level" "performance_level",
	"is_complete" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_results_assessment_id_student_id_unique" UNIQUE("assessment_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "skill_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"percentage" numeric(5, 2),
	"performance_level" "performance_level",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skill_results_assessment_id_student_id_node_id_unique" UNIQUE("assessment_id","student_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_filter" jsonb,
	"record_count" integer,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_by_user_id" uuid,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"notes" text,
	CONSTRAINT "platform_admins_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_classes" ADD CONSTRAINT "subject_classes_class_group_id_class_groups_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_classes" ADD CONSTRAINT "subject_classes_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_classes" ADD CONSTRAINT "subject_classes_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_subject_class_id_subject_classes_id_fk" FOREIGN KEY ("subject_class_id") REFERENCES "public"."subject_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_class_group_id_class_groups_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomies" ADD CONSTRAINT "taxonomies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy_mappings" ADD CONSTRAINT "taxonomy_mappings_source_node_id_taxonomy_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy_mappings" ADD CONSTRAINT "taxonomy_mappings_target_node_id_taxonomy_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy_nodes" ADD CONSTRAINT "taxonomy_nodes_taxonomy_id_taxonomies_id_fk" FOREIGN KEY ("taxonomy_id") REFERENCES "public"."taxonomies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy_nodes" ADD CONSTRAINT "taxonomy_nodes_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy_nodes" ADD CONSTRAINT "taxonomy_nodes_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_scales" ADD CONSTRAINT "grading_scales_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_sections" ADD CONSTRAINT "instrument_sections_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_taxonomy_id_taxonomies_id_fk" FOREIGN KEY ("taxonomy_id") REFERENCES "public"."taxonomies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_grading_scale_id_grading_scales_id_fk" FOREIGN KEY ("grading_scale_id") REFERENCES "public"."grading_scales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_taxonomy_tags" ADD CONSTRAINT "item_taxonomy_tags_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_taxonomy_tags" ADD CONSTRAINT "item_taxonomy_tags_node_id_taxonomy_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_versions" ADD CONSTRAINT "item_versions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_versions" ADD CONSTRAINT "item_versions_changed_by_id_users_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_section_id_instrument_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."instrument_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_rubric_id_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_taxonomy_node_id_taxonomy_nodes_id_fk" FOREIGN KEY ("taxonomy_node_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_levels" ADD CONSTRAINT "rubric_levels_criterion_id_rubric_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."rubric_criteria"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_course_assignments" ADD CONSTRAINT "assessment_course_assignments_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_course_assignments" ADD CONSTRAINT "assessment_course_assignments_class_group_id_class_groups_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_forms" ADD CONSTRAINT "assessment_forms_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_administered_by_id_users_id_fk" FOREIGN KEY ("administered_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_grading_jobs" ADD CONSTRAINT "ai_grading_jobs_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_form_id_assessment_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."assessment_forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_results" ADD CONSTRAINT "skill_results_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_results" ADD CONSTRAINT "skill_results_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_results" ADD CONSTRAINT "skill_results_node_id_taxonomy_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "taxonomies_official_type_version_uniq" ON "taxonomies" USING btree ("type","version") WHERE "taxonomies"."is_official" = true AND "taxonomies"."org_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "taxonomy_nodes_taxonomy_code_uniq" ON "taxonomy_nodes" USING btree ("taxonomy_id","code") WHERE "taxonomy_nodes"."code" IS NOT NULL;
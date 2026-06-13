CREATE TYPE "public"."ai_analysis_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "ai_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"assessment_id" uuid,
	"class_group_id" uuid,
	"analysis_type" text NOT NULL,
	"audience" text DEFAULT 'general' NOT NULL,
	"status" "ai_analysis_status" DEFAULT 'pending' NOT NULL,
	"model" text,
	"prompt_version" text,
	"input_hash" text,
	"input" jsonb,
	"output" jsonb,
	"tokens" jsonb,
	"cost_usd" numeric(10, 6),
	"error" text,
	"created_by_id" uuid,
	"started_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "org_benchmark_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"opt_out_global_pool" boolean DEFAULT false NOT NULL,
	"consent_granted_at" timestamp,
	"consent_granted_by_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_benchmark_settings_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_benchmark_settings" ADD CONSTRAINT "org_benchmark_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_benchmark_settings" ADD CONSTRAINT "org_benchmark_settings_consent_granted_by_id_users_id_fk" FOREIGN KEY ("consent_granted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_analyses_lookup_idx" ON "ai_analyses" USING btree ("org_id","assessment_id","analysis_type","audience");--> statement-breakpoint
CREATE INDEX "ai_analyses_input_hash_idx" ON "ai_analyses" USING btree ("input_hash");
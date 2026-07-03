CREATE TYPE "public"."benchmark_mode" AS ENUM('global', 'network');--> statement-breakpoint
CREATE TABLE "benchmark_access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"mode" "benchmark_mode" NOT NULL,
	"instrument_id" uuid,
	"filters" jsonb,
	"cohort_school_count" integer,
	"cohort_student_count" integer,
	"suppressed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"grade_id" uuid,
	"subject_id" uuid,
	"dependence" "school_dependence",
	"region" text,
	"commune" text,
	"network_org_id" uuid,
	"student_count" integer DEFAULT 0 NOT NULL,
	"avg_achievement" numeric(5, 2),
	"band_distribution" jsonb,
	"per_skill" jsonb,
	"opt_out_global_pool" boolean DEFAULT false NOT NULL,
	"refreshed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "benchmark_aggregates_dims_uq" UNIQUE("org_id","instrument_id","grade_id","subject_id")
);
--> statement-breakpoint
ALTER TABLE "benchmark_access_logs" ADD CONSTRAINT "benchmark_access_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_access_logs" ADD CONSTRAINT "benchmark_access_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_aggregates" ADD CONSTRAINT "benchmark_aggregates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_aggregates" ADD CONSTRAINT "benchmark_aggregates_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "benchmark_access_logs_org_idx" ON "benchmark_access_logs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "benchmark_aggregates_cohort_idx" ON "benchmark_aggregates" USING btree ("instrument_id","grade_id","subject_id");--> statement-breakpoint
CREATE INDEX "benchmark_aggregates_network_idx" ON "benchmark_aggregates" USING btree ("network_org_id");
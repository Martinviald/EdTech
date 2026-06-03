CREATE TYPE "public"."metric_type" AS ENUM('percentage', 'scaled', 'band');--> statement-breakpoint
CREATE TABLE "performance_bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scale_id" uuid,
	"org_id" uuid,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"min_threshold" numeric(5, 4) NOT NULL,
	"max_threshold" numeric(5, 4) NOT NULL,
	"color" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessment_results" ADD COLUMN "metric_type" "metric_type" DEFAULT 'percentage' NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_results" ADD COLUMN "scaled_score" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "assessment_results" ADD COLUMN "band_label" text;--> statement-breakpoint
ALTER TABLE "assessment_results" ADD COLUMN "performance_band_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_results" ADD COLUMN "performance_band_id" uuid;--> statement-breakpoint
ALTER TABLE "performance_bands" ADD CONSTRAINT "performance_bands_scale_id_grading_scales_id_fk" FOREIGN KEY ("scale_id") REFERENCES "public"."grading_scales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_bands" ADD CONSTRAINT "performance_bands_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_performance_band_id_performance_bands_id_fk" FOREIGN KEY ("performance_band_id") REFERENCES "public"."performance_bands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_results" ADD CONSTRAINT "skill_results_performance_band_id_performance_bands_id_fk" FOREIGN KEY ("performance_band_id") REFERENCES "public"."performance_bands"("id") ON DELETE no action ON UPDATE no action;
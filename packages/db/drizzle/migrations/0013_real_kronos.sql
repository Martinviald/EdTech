CREATE TABLE "assessment_level_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"performance_band_id" uuid NOT NULL,
	"student_count" integer NOT NULL,
	"source" "stats_source" NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_level_stats_assessment_id_class_group_id_performance_band_id_unique" UNIQUE("assessment_id","class_group_id","performance_band_id")
);
--> statement-breakpoint
ALTER TABLE "assessment_level_stats" ADD CONSTRAINT "assessment_level_stats_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_level_stats" ADD CONSTRAINT "assessment_level_stats_class_group_id_class_groups_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_level_stats" ADD CONSTRAINT "assessment_level_stats_performance_band_id_performance_bands_id_fk" FOREIGN KEY ("performance_band_id") REFERENCES "public"."performance_bands"("id") ON DELETE no action ON UPDATE no action;
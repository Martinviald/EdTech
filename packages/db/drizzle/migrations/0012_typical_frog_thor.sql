CREATE TYPE "public"."data_granularity" AS ENUM('item_level', 'aggregate_only');--> statement-breakpoint
CREATE TYPE "public"."stats_source" AS ENUM('computed', 'imported');--> statement-breakpoint
ALTER TYPE "public"."import_job_type" ADD VALUE 'dia_official_report';--> statement-breakpoint
CREATE TABLE "assessment_item_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"student_count" integer NOT NULL,
	"response_count" integer NOT NULL,
	"correct_count" integer NOT NULL,
	"answer_counts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score_sum" numeric(9, 2) NOT NULL,
	"max_sum" numeric(9, 2) NOT NULL,
	"source" "stats_source" NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_item_stats_assessment_id_class_group_id_item_id_unique" UNIQUE("assessment_id","class_group_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "assessment_skill_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"student_count" integer NOT NULL,
	"correct_count" integer NOT NULL,
	"total_count" integer NOT NULL,
	"percentage" numeric(5, 2),
	"source" "stats_source" NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_skill_stats_assessment_id_class_group_id_node_id_unique" UNIQUE("assessment_id","class_group_id","node_id")
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "data_granularity" "data_granularity" DEFAULT 'item_level' NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_item_stats" ADD CONSTRAINT "assessment_item_stats_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_item_stats" ADD CONSTRAINT "assessment_item_stats_class_group_id_class_groups_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_item_stats" ADD CONSTRAINT "assessment_item_stats_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_skill_stats" ADD CONSTRAINT "assessment_skill_stats_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_skill_stats" ADD CONSTRAINT "assessment_skill_stats_class_group_id_class_groups_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_skill_stats" ADD CONSTRAINT "assessment_skill_stats_node_id_taxonomy_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessment_item_stats_item_idx" ON "assessment_item_stats" USING btree ("assessment_id","item_id");
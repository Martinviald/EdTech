CREATE TYPE "public"."remedial_material_type" AS ENUM('guide', 'practice_set', 'group_plan');--> statement-breakpoint
CREATE TYPE "public"."remedial_status" AS ENUM('pending', 'processing', 'ready', 'failed', 'approved', 'discarded');--> statement-breakpoint
CREATE TABLE "remedial_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" "remedial_material_type" NOT NULL,
	"status" "remedial_status" DEFAULT 'pending' NOT NULL,
	"node_id" uuid,
	"assessment_id" uuid,
	"class_group_id" uuid,
	"source_analysis_id" uuid,
	"title" text,
	"content" jsonb,
	"input" jsonb,
	"input_hash" text,
	"model" text,
	"prompt_version" text,
	"tokens" jsonb,
	"cost_usd" numeric(10, 6),
	"error" text,
	"created_by_id" uuid,
	"reviewed_by_id" uuid,
	"started_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"reviewed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "remedial_materials" ADD CONSTRAINT "remedial_materials_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remedial_materials" ADD CONSTRAINT "remedial_materials_node_id_taxonomy_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remedial_materials" ADD CONSTRAINT "remedial_materials_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "remedial_materials_lookup_idx" ON "remedial_materials" USING btree ("org_id","type","node_id","status");--> statement-breakpoint
CREATE INDEX "remedial_materials_input_hash_idx" ON "remedial_materials" USING btree ("input_hash");
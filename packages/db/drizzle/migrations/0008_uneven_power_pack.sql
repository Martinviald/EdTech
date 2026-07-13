CREATE TYPE "public"."remedial_method" AS ENUM('self_contained', 'reuse_stimulus', 'generate_stimulus');--> statement-breakpoint
CREATE TYPE "public"."stimulus_kind" AS ENUM('passage', 'figure', 'table', 'dataset');--> statement-breakpoint
CREATE TYPE "public"."stimulus_source" AS ENUM('official', 'ai_generated');--> statement-breakpoint
ALTER TABLE "instrument_sections" ALTER COLUMN "instrument_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "instrument_sections" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "instrument_sections" ADD COLUMN "kind" "stimulus_kind" DEFAULT 'passage' NOT NULL;--> statement-breakpoint
ALTER TABLE "instrument_sections" ADD COLUMN "source" "stimulus_source" DEFAULT 'official' NOT NULL;--> statement-breakpoint
ALTER TABLE "remedial_materials" ADD COLUMN "method" "remedial_method" DEFAULT 'self_contained' NOT NULL;--> statement-breakpoint
ALTER TABLE "remedial_materials" ADD COLUMN "quality_report" jsonb;--> statement-breakpoint
ALTER TABLE "instrument_sections" ADD CONSTRAINT "instrument_sections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instrument_sections_org_kind_idx" ON "instrument_sections" USING btree ("org_id","kind");
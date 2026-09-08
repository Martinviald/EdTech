ALTER TABLE "sheet_layouts" DROP CONSTRAINT "sheet_layouts_org_instrument_version_uq";--> statement-breakpoint
ALTER TABLE "sheet_layouts" ADD COLUMN "assessment_form_id" uuid;--> statement-breakpoint
ALTER TABLE "sheet_layouts" ADD CONSTRAINT "sheet_layouts_assessment_form_id_assessment_forms_id_fk" FOREIGN KEY ("assessment_form_id") REFERENCES "public"."assessment_forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_layouts_org_instrument_version_uq" ON "sheet_layouts" USING btree ("org_id","instrument_id","version") WHERE "sheet_layouts"."assessment_form_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_layouts_org_form_version_uq" ON "sheet_layouts" USING btree ("org_id","assessment_form_id","version") WHERE "sheet_layouts"."assessment_form_id" is not null;--> statement-breakpoint
CREATE INDEX "sheet_layouts_form_idx" ON "sheet_layouts" USING btree ("assessment_form_id");
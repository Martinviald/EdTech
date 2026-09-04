ALTER TABLE "printed_sheets" ADD COLUMN "short_code" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "printed_sheets_org_short_code_uq" ON "printed_sheets" USING btree ("org_id","short_code");
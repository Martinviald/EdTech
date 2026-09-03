CREATE TYPE "public"."mark_review_decision" AS ENUM('option', 'blank', 'annulled');--> statement-breakpoint
ALTER TABLE "sheet_scan_marks" ADD COLUMN "review_decision" "mark_review_decision";--> statement-breakpoint
UPDATE "sheet_scan_marks" SET "review_decision" = CASE WHEN "reviewed_value" IS NULL THEN 'blank'::"public"."mark_review_decision" ELSE 'option'::"public"."mark_review_decision" END WHERE "reviewed_at" IS NOT NULL AND "review_decision" IS NULL;

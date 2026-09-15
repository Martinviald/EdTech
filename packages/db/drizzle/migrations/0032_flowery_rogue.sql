ALTER TABLE "sheet_scan_marks" ADD COLUMN "suggested_value" text;--> statement-breakpoint
ALTER TABLE "sheet_scan_marks" ADD COLUMN "doubt_reason" text;--> statement-breakpoint
ALTER TABLE "sheet_scan_marks" ADD COLUMN "null_confidence" numeric(4, 3);
ALTER TABLE "answer_reading_decisions" DROP CONSTRAINT "answer_reading_decisions_mark_id_sheet_scan_marks_id_fk";
--> statement-breakpoint
ALTER TABLE "answer_readings" DROP CONSTRAINT "answer_readings_mark_id_sheet_scan_marks_id_fk";
--> statement-breakpoint
DROP INDEX "answer_reading_decisions_group_idx";--> statement-breakpoint
ALTER TABLE "answer_reading_decisions" ADD CONSTRAINT "answer_reading_decisions_mark_id_sheet_scan_marks_id_fk" FOREIGN KEY ("mark_id") REFERENCES "public"."sheet_scan_marks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_readings" ADD CONSTRAINT "answer_readings_mark_id_sheet_scan_marks_id_fk" FOREIGN KEY ("mark_id") REFERENCES "public"."sheet_scan_marks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answer_reading_decisions_mark_history_idx" ON "answer_reading_decisions" USING btree ("org_id","mark_id","created_at");--> statement-breakpoint
CREATE INDEX "answer_reading_decisions_group_idx" ON "answer_reading_decisions" USING btree ("org_id","assessment_id","item_id","canonical") WHERE "answer_reading_decisions"."superseded_by_id" IS NULL AND "answer_reading_decisions"."outcome" = 'needs_review';
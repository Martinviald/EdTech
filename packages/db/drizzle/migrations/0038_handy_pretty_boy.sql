CREATE INDEX "idx_student_enrollments_class_group" ON "student_enrollments" USING btree ("class_group_id");--> statement-breakpoint
CREATE INDEX "instruments_org_deleted_idx" ON "instruments" USING btree ("org_id","deleted_at");--> statement-breakpoint
CREATE INDEX "instruments_subject_idx" ON "instruments" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "idx_assessments_org" ON "assessments" USING btree ("org_id");
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_subject_class_id_subject_classes_id_fk" FOREIGN KEY ("subject_class_id") REFERENCES "public"."subject_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- RLS: teacher_assignments hereda pertenencia de tenant vía subject_classes → class_groups.org_id
ALTER TABLE "teacher_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "teacher_assignments_tenant_isolation" ON "teacher_assignments"
  AS PERMISSIVE FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "subject_classes"
      JOIN "class_groups" ON "class_groups"."id" = "subject_classes"."class_group_id"
      WHERE "subject_classes"."id" = "teacher_assignments"."subject_class_id"
        AND "class_groups"."org_id"::text = current_setting('app.current_org_id', true)
    )
  );

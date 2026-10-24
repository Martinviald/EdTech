ALTER TABLE "ai_grading_jobs" ADD COLUMN "org_id" uuid;--> statement-breakpoint
UPDATE "ai_grading_jobs" AS j SET "org_id" = a."org_id" FROM "responses" AS r JOIN "assessments" AS a ON a."id" = r."assessment_id" WHERE r."id" = j."response_id";--> statement-breakpoint
ALTER TABLE "ai_grading_jobs" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_grading_jobs" ADD CONSTRAINT "ai_grading_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_grading_jobs_org" ON "ai_grading_jobs" USING btree ("org_id");

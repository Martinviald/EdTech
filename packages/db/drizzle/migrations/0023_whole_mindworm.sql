CREATE TYPE "public"."feedback_status" AS ENUM('new', 'triaged', 'planned', 'done', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."feedback_type" AS ENUM('bug', 'idea', 'confusion');--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_by_id" uuid,
	"type" "feedback_type" NOT NULL,
	"status" "feedback_status" DEFAULT 'new' NOT NULL,
	"message" text NOT NULL,
	"context" jsonb NOT NULL,
	"screenshot_file_id" uuid,
	"internal_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_screenshot_file_id_files_id_fk" FOREIGN KEY ("screenshot_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_org_created_idx" ON "feedback" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_org_status_idx" ON "feedback" USING btree ("org_id","status");
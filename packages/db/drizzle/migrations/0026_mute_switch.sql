CREATE TYPE "public"."capture_session_status" AS ENUM('pending', 'active', 'closed', 'revoked', 'expired');--> statement-breakpoint
CREATE TABLE "capture_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"print_run_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"status" "capture_session_status" DEFAULT 'pending' NOT NULL,
	"secret_hash" text NOT NULL,
	"redeem_count" integer DEFAULT 0 NOT NULL,
	"captures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capture_sessions" ADD CONSTRAINT "capture_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_sessions" ADD CONSTRAINT "capture_sessions_print_run_id_sheet_print_runs_id_fk" FOREIGN KEY ("print_run_id") REFERENCES "public"."sheet_print_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_sessions" ADD CONSTRAINT "capture_sessions_batch_id_sheet_scan_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."sheet_scan_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_sessions" ADD CONSTRAINT "capture_sessions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capture_sessions_org_status_idx" ON "capture_sessions" USING btree ("org_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "capture_sessions_batch_idx" ON "capture_sessions" USING btree ("batch_id");
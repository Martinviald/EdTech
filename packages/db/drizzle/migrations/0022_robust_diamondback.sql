CREATE TABLE "telemetry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"event_name" text NOT NULL,
	"event_category" text NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"role" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD CONSTRAINT "telemetry_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD CONSTRAINT "telemetry_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telemetry_events_org_created_idx" ON "telemetry_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "telemetry_events_org_name_idx" ON "telemetry_events" USING btree ("org_id","event_name");--> statement-breakpoint
CREATE INDEX "telemetry_events_org_category_idx" ON "telemetry_events" USING btree ("org_id","event_category");--> statement-breakpoint
CREATE INDEX "telemetry_events_org_user_idx" ON "telemetry_events" USING btree ("org_id","user_id");
CREATE TYPE "public"."decision_call_status" AS ENUM('ok', 'error');--> statement-breakpoint
CREATE TYPE "public"."decision_mode" AS ENUM('off', 'shadow', 'live');--> statement-breakpoint
CREATE TABLE "decision_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"engine" text NOT NULL,
	"model" text,
	"mode" "decision_mode" NOT NULL,
	"status" "decision_call_status" NOT NULL,
	"error_code" text,
	"answers" jsonb,
	"baseline" jsonb,
	"state_hash" text NOT NULL,
	"correlation_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"cost_usd" numeric(14, 9),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"feature" text NOT NULL,
	"engine" text DEFAULT 'jev' NOT NULL,
	"model" text NOT NULL,
	"mode" "decision_mode" DEFAULT 'off' NOT NULL,
	"thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_calls" ADD CONSTRAINT "decision_calls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_settings" ADD CONSTRAINT "decision_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_calls_org_feature_created_idx" ON "decision_calls" USING btree ("org_id","feature","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_settings_global_feature_uniq" ON "decision_settings" USING btree ("feature") WHERE "decision_settings"."org_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_settings_org_feature_uniq" ON "decision_settings" USING btree ("org_id","feature") WHERE "decision_settings"."org_id" IS NOT NULL;
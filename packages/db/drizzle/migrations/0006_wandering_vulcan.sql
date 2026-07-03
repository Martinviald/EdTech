CREATE TABLE "llm_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_settings" ADD CONSTRAINT "llm_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "llm_settings_global_feature_uniq" ON "llm_settings" USING btree ("feature") WHERE "llm_settings"."org_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "llm_settings_org_feature_uniq" ON "llm_settings" USING btree ("org_id","feature") WHERE "llm_settings"."org_id" IS NOT NULL;
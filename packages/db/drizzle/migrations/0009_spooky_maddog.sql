CREATE TYPE "public"."item_edit_proposal_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "item_edit_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"status" "item_edit_proposal_status" DEFAULT 'pending' NOT NULL,
	"author" "tagged_by" DEFAULT 'ai' NOT NULL,
	"item_type" "item_type" NOT NULL,
	"instruction" text,
	"reasoning" text,
	"current_content" jsonb,
	"proposed_content" jsonb NOT NULL,
	"applied_version" integer,
	"model" text,
	"prompt_version" text,
	"tokens" jsonb,
	"cost_usd" numeric(10, 6),
	"created_by_id" uuid,
	"reviewed_by_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "item_edit_proposals" ADD CONSTRAINT "item_edit_proposals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_edit_proposals" ADD CONSTRAINT "item_edit_proposals_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_edit_proposals" ADD CONSTRAINT "item_edit_proposals_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_edit_proposals" ADD CONSTRAINT "item_edit_proposals_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_edit_proposals_lookup_idx" ON "item_edit_proposals" USING btree ("org_id","item_id","status");
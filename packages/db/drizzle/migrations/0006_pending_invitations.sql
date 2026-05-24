ALTER TABLE "org_memberships" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD COLUMN "invited_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD COLUMN "invited_at" timestamp;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_or_email_chk" CHECK (("user_id" IS NOT NULL) OR ("email" IS NOT NULL));--> statement-breakpoint
CREATE UNIQUE INDEX "org_memberships_pending_email_role_uniq" ON "org_memberships" ("org_id", lower("email"), "role") WHERE "user_id" IS NULL;
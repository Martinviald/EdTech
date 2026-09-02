CREATE TABLE "mcp_user_active_org" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_user_active_org" ADD CONSTRAINT "mcp_user_active_org_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_user_active_org" ADD CONSTRAINT "mcp_user_active_org_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
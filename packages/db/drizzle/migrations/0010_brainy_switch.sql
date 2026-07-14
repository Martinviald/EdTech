CREATE TYPE "public"."file_status" AS ENUM('pending', 'ready');--> statement-breakpoint
CREATE TYPE "public"."item_edit_proposal_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "instrument_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"storage_key" text,
	"url" text,
	"file_name" text,
	"mime_type" text,
	"size_bytes" integer,
	"note" text,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"status" "file_status" DEFAULT 'pending' NOT NULL,
	"storage_key" text NOT NULL,
	"bucket" text,
	"file_name" text,
	"mime_type" text,
	"size_bytes" integer,
	"checksum" text,
	"url" text,
	"owner_type" text,
	"owner_id" uuid,
	"purpose" text,
	"note" text,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"created_by_id" uuid,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
ALTER TABLE "remedial_materials" ADD COLUMN "edited_content" jsonb;--> statement-breakpoint
ALTER TABLE "instrument_attachments" ADD CONSTRAINT "instrument_attachments_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_edit_proposals" ADD CONSTRAINT "item_edit_proposals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_edit_proposals" ADD CONSTRAINT "item_edit_proposals_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_edit_proposals" ADD CONSTRAINT "item_edit_proposals_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_edit_proposals" ADD CONSTRAINT "item_edit_proposals_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("owner_type","owner_id","purpose");--> statement-breakpoint
CREATE INDEX "files_storage_key_idx" ON "files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "files_org_idx" ON "files" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "item_edit_proposals_lookup_idx" ON "item_edit_proposals" USING btree ("org_id","item_id","status");--> statement-breakpoint
-- Backfill (TKT-15 → módulo `files`): migra los PDF de enunciado existentes de
-- `instrument_attachments` (kind='pdf') al registro genérico `files`. Preserva el id
-- para trazabilidad e idempotencia (NOT EXISTS). `org_id` se hereda del instrumento
-- padre (null = oficial/global). `instrument_attachments` queda DEPRECADA (no se
-- elimina en este sprint para evitar un DROP destructivo sobre datos existentes).
INSERT INTO "files" (
	"id", "org_id", "status", "storage_key", "file_name", "mime_type", "size_bytes",
	"url", "owner_type", "owner_id", "purpose", "note", "meta", "created_at", "updated_at"
)
SELECT
	ia."id",
	i."org_id",
	'ready',
	ia."storage_key",
	ia."file_name",
	ia."mime_type",
	ia."size_bytes",
	ia."url",
	'instrument',
	ia."instrument_id",
	'enunciado_pdf',
	ia."note",
	COALESCE(ia."meta", '{}'::jsonb),
	ia."created_at",
	ia."updated_at"
FROM "instrument_attachments" ia
JOIN "instruments" i ON i."id" = ia."instrument_id"
WHERE ia."kind" = 'pdf'
	AND ia."storage_key" IS NOT NULL
	AND NOT EXISTS (SELECT 1 FROM "files" f WHERE f."id" = ia."id");
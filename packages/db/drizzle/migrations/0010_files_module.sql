CREATE TYPE "public"."file_status" AS ENUM('pending', 'ready');--> statement-breakpoint
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
ALTER TABLE "files" ADD CONSTRAINT "files_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("owner_type","owner_id","purpose");--> statement-breakpoint
CREATE INDEX "files_storage_key_idx" ON "files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "files_org_idx" ON "files" USING btree ("org_id");--> statement-breakpoint
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
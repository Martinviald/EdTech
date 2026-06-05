CREATE TYPE "public"."attachment_kind" AS ENUM('image', 'audio', 'pdf', 'other');--> statement-breakpoint
CREATE TYPE "public"."passage_format" AS ENUM('plain', 'markdown', 'html');--> statement-breakpoint
CREATE TABLE "section_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
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
ALTER TABLE "instrument_sections" ADD COLUMN "passage_title" text;--> statement-breakpoint
ALTER TABLE "instrument_sections" ADD COLUMN "passage_text" text;--> statement-breakpoint
ALTER TABLE "instrument_sections" ADD COLUMN "passage_format" "passage_format";--> statement-breakpoint
ALTER TABLE "section_attachments" ADD CONSTRAINT "section_attachments_section_id_instrument_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."instrument_sections"("id") ON DELETE cascade ON UPDATE no action;
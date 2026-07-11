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
ALTER TABLE "remedial_materials" ADD COLUMN "edited_content" jsonb;--> statement-breakpoint
ALTER TABLE "instrument_attachments" ADD CONSTRAINT "instrument_attachments_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;
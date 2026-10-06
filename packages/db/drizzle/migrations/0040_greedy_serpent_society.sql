CREATE TABLE "test_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"subject_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "test_tracks_id_subject_uniq" UNIQUE("id","subject_id")
);
--> statement-breakpoint
ALTER TABLE "measurement_processes" DROP CONSTRAINT "measurement_processes_org_slug_unique";--> statement-breakpoint
ALTER TABLE "instrument_sections" ADD COLUMN "track_id" uuid;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "track_id" uuid;--> statement-breakpoint
ALTER TABLE "test_tracks" ADD CONSTRAINT "test_tracks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_tracks" ADD CONSTRAINT "test_tracks_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "test_tracks_official_subject_code_uniq" ON "test_tracks" USING btree ("subject_id","code") WHERE "test_tracks"."org_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "test_tracks_org_subject_code_uniq" ON "test_tracks" USING btree ("org_id","subject_id","code") WHERE "test_tracks"."org_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "instrument_sections" ADD CONSTRAINT "instrument_sections_track_id_test_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."test_tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_track_subject_fk" FOREIGN KEY ("track_id","subject_id") REFERENCES "public"."test_tracks"("id","subject_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "measurement_processes_org_slug_active_uniq" ON "measurement_processes" USING btree ("org_id","slug") WHERE "measurement_processes"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "instrument_sections" ADD CONSTRAINT "instrument_sections_elective_requires_track" CHECK ("instrument_sections"."role" <> 'elective' OR "instrument_sections"."track_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "instrument_sections" ADD CONSTRAINT "instrument_sections_track_only_elective" CHECK ("instrument_sections"."track_id" IS NULL OR "instrument_sections"."role" = 'elective');--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_track_requires_subject" CHECK ("instruments"."track_id" IS NULL OR "instruments"."subject_id" IS NOT NULL);
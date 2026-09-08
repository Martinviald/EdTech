CREATE TABLE "read_model_stamps" (
	"id" text PRIMARY KEY NOT NULL,
	"calculator_hash" text NOT NULL,
	"migration_tag" text NOT NULL,
	"assessments_count" integer NOT NULL,
	"backfilled_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TYPE "public"."answer_reading_mode" ADD VALUE 'verifier';--> statement-breakpoint
ALTER TABLE "answer_readings" ADD COLUMN "verification_output" jsonb;
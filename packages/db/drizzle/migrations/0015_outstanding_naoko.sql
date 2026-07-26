CREATE TYPE "public"."item_difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "difficulty" "item_difficulty";
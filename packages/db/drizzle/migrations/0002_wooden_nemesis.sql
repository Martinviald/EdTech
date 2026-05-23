CREATE TYPE "public"."school_dependence" AS ENUM('municipal', 'particular_pagado', 'particular_subvencionado', 'delegada');--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "commune" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "dependence" "school_dependence";
ALTER TABLE "assessment_skill_stats" ADD COLUMN "score_sum" numeric(9, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_skill_stats" ADD COLUMN "max_sum" numeric(9, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_results" ADD COLUMN "score_sum" numeric(9, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_results" ADD COLUMN "max_sum" numeric(9, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "benchmark_aggregates" ADD COLUMN "score_sum" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "benchmark_aggregates" ADD COLUMN "max_sum" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "benchmark_item_aggregates" ADD COLUMN "score_sum" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "benchmark_item_aggregates" ADD COLUMN "max_sum" numeric(12, 2) DEFAULT '0' NOT NULL;
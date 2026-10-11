ALTER TABLE "llm_models" ADD COLUMN "supports_sampling_params" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "llm_models" SET "supports_sampling_params" = false WHERE ("provider" = 'anthropic' AND "model_id" IN ('claude-haiku-5-5','claude-sonnet-5-5','claude-opus-5-5')) OR "provider" = 'openai';

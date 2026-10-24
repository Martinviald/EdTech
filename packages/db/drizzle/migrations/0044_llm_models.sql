CREATE TABLE "llm_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"label" text NOT NULL,
	"max_output_tokens" integer NOT NULL,
	"supports_images" boolean DEFAULT false NOT NULL,
	"supports_structured_output" boolean DEFAULT false NOT NULL,
	"supports_batch" boolean DEFAULT false NOT NULL,
	"input_usd_per_mtok" numeric(12, 6) NOT NULL,
	"output_usd_per_mtok" numeric(12, 6) NOT NULL,
	"cached_input_usd_per_mtok" numeric(12, 6),
	"batch_discount" numeric(4, 3),
	"enabled" boolean DEFAULT true NOT NULL,
	"deprecated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "llm_models_provider_model_uniq" ON "llm_models" USING btree ("provider","model_id");--> statement-breakpoint
INSERT INTO "llm_models" ("provider", "model_id", "label", "max_output_tokens", "supports_images", "supports_structured_output", "supports_batch", "input_usd_per_mtok", "output_usd_per_mtok", "cached_input_usd_per_mtok", "batch_discount") VALUES
('gemini','gemini-2.5-flash','Gemini 2.5 Flash',8192,true,true,true,0.30,2.50,NULL,0.5),
('gemini','gemini-2.5-pro','Gemini 2.5 Pro',32768,true,true,true,1.25,10,NULL,0.5),
('anthropic','claude-haiku-4-5-20251001','Claude Haiku 4.5',8192,true,true,true,1,5,NULL,0.5),
('anthropic','claude-sonnet-4-6','Claude Sonnet 4.6',16384,true,true,true,3,15,NULL,0.5),
('anthropic','claude-opus-4-8','Claude Opus 4.8',16384,true,true,true,5,25,NULL,0.5),
('anthropic','claude-haiku-5-5','Claude Haiku 5.5',8192,true,true,true,0.10,0.50,NULL,0.5),
('anthropic','claude-sonnet-5-5','Claude Sonnet 5.5',16384,true,true,true,2,10,NULL,0.5),
('anthropic','claude-opus-5-5','Claude Opus 5.5',16384,true,true,true,4,20,NULL,0.5),
('gemini','gemini-3.1-flash-lite','Gemini 3.1 Flash-Lite',8192,true,true,true,0.25,1.50,NULL,0.5),
('gemini','gemini-3.5-flash-lite','Gemini 3.5 Flash-Lite',8192,true,true,true,0.30,2.50,NULL,0.5),
('gemini','gemini-3.8-flash','Gemini 3.8 Flash',16384,true,true,true,0.75,3.75,NULL,0.5)
ON CONFLICT ("provider", "model_id") DO NOTHING;

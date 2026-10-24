INSERT INTO "llm_models" ("provider", "model_id", "label", "max_output_tokens", "supports_images", "supports_structured_output", "supports_batch", "input_usd_per_mtok", "output_usd_per_mtok", "cached_input_usd_per_mtok", "batch_discount", "enabled") VALUES
('openai','gpt-6-luna','GPT-6 Luna',16384,true,true,true,0.10,0.50,0.01,0.5,true),
('openai','gpt-5.6-luna','GPT-5.6 Luna',16384,true,true,true,0.20,1.20,NULL,0.5,true),
('openai','gpt-5.4-mini','GPT-5.4 mini',16384,true,true,true,0.75,4.50,NULL,0.5,true)
ON CONFLICT ("provider", "model_id") DO NOTHING;

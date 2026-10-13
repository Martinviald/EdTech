INSERT INTO "llm_models" ("provider", "model_id", "label", "max_output_tokens", "supports_images", "supports_structured_output", "supports_batch", "input_usd_per_mtok", "output_usd_per_mtok", "cached_input_usd_per_mtok", "batch_discount", "enabled", "supports_sampling_params") VALUES
('gemini','gemini-3.6-flash','Gemini 3.6 Flash',16384,true,true,true,1.50,7.50,NULL,0.5,true,true),
('gemini','gemini-3.8-flash','Gemini 3.8 Flash',16384,true,true,true,1.50,7.50,NULL,0.5,true,true)
ON CONFLICT ("provider", "model_id") DO NOTHING;
--> statement-breakpoint
UPDATE "llm_models" SET "input_usd_per_mtok" = 1.50, "output_usd_per_mtok" = 7.50, "updated_at" = now()
WHERE "provider" = 'gemini' AND "model_id" IN ('gemini-3.6-flash','gemini-3.8-flash')
  AND ("input_usd_per_mtok" <> 1.50 OR "output_usd_per_mtok" <> 7.50);
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000001' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-00000000000c', NULL, 'active', 'default', NULL,
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.short-answer@2","hints":"none","params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000},"minConfidence":0.97},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.short-answer@2","hints":"none","params":{"maxOutputTokens":2048,"reasoning":"low","mediaResolution":"medium","timeoutMs":30000},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-default","version":1,"minReaders":2,"requireDistinctFamilies":true,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"autoAccept":true,"autoAcceptOutcomes":["correct","incorrect"],"auditSampleRate":0.1}'::jsonb,
 2, '7ead0000-0000-4000-8000-000000000001', 'pipeline B: gemini-3.8-flash (umbral 0,97) + gpt-6-luna reasoning low (umbral 0,85); desarrollo con gemini-3.8-flash (etapa 1, T2)', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000005' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-00000000000d', NULL, 'active', 'format', 'free_text',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.free-text@1","hints":"none","params":{"maxOutputTokens":4096,"reasoning":"off","mediaResolution":"medium","timeoutMs":60000}}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"free-text-default","version":1,"minReaders":1,"requireDistinctFamilies":false,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"autoAccept":false,"autoAcceptOutcomes":[],"auditSampleRate":0}'::jsonb,
 2, '7ead0000-0000-4000-8000-000000000005', 'pipeline B: gemini-3.8-flash (umbral 0,97) + gpt-6-luna reasoning low (umbral 0,85); desarrollo con gemini-3.8-flash (etapa 1, T2)', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000006' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-00000000000e', NULL, 'active', 'format', 'math_work',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.free-text@1","hints":"none","params":{"maxOutputTokens":4096,"reasoning":"off","mediaResolution":"medium","timeoutMs":60000}}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"free-text-default","version":1,"minReaders":1,"requireDistinctFamilies":false,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"autoAccept":false,"autoAcceptOutcomes":[],"auditSampleRate":0}'::jsonb,
 2, '7ead0000-0000-4000-8000-000000000006', 'pipeline B: gemini-3.8-flash (umbral 0,97) + gpt-6-luna reasoning low (umbral 0,85); desarrollo con gemini-3.8-flash (etapa 1, T2)', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000007' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-00000000000f', NULL, 'active', 'format', 'sequence',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.boxes@1","hints":"format","params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000},"minConfidence":0.97},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.boxes@1","hints":"format","params":{"maxOutputTokens":2048,"reasoning":"low","mediaResolution":"medium","timeoutMs":30000},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-default","version":1,"minReaders":2,"requireDistinctFamilies":true,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"autoAccept":true,"autoAcceptOutcomes":["correct","incorrect"],"auditSampleRate":0.1}'::jsonb,
 2, '7ead0000-0000-4000-8000-000000000007', 'pipeline B: gemini-3.8-flash (umbral 0,97) + gpt-6-luna reasoning low (umbral 0,85); desarrollo con gemini-3.8-flash (etapa 1, T2)', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000008' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000010', NULL, 'active', 'format', 'ordered_tuple',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.short-answer@2","hints":"format","params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000},"minConfidence":0.97},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.short-answer@2","hints":"format","params":{"maxOutputTokens":2048,"reasoning":"low","mediaResolution":"medium","timeoutMs":30000},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-default","version":1,"minReaders":2,"requireDistinctFamilies":true,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"autoAccept":true,"autoAcceptOutcomes":["correct","incorrect"],"auditSampleRate":0.1}'::jsonb,
 2, '7ead0000-0000-4000-8000-000000000008', 'pipeline B: gemini-3.8-flash (umbral 0,97) + gpt-6-luna reasoning low (umbral 0,85); desarrollo con gemini-3.8-flash (etapa 1, T2)', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000009' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000011', NULL, 'active', 'format', 'word_list',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.short-text@2","hints":"format","params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000},"minConfidence":0.97},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.short-text@2","hints":"format","params":{"maxOutputTokens":2048,"reasoning":"low","mediaResolution":"medium","timeoutMs":30000},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-text-default","version":1,"minReaders":2,"requireDistinctFamilies":true,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"autoAccept":true,"autoAcceptOutcomes":["correct","incorrect"],"auditSampleRate":0.1}'::jsonb,
 3, '7ead0000-0000-4000-8000-000000000009', 'pipeline B: gemini-3.8-flash (umbral 0,97) + gpt-6-luna reasoning low (umbral 0,85); desarrollo con gemini-3.8-flash (etapa 1, T2)', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-00000000000a' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000012', NULL, 'active', 'format', 'short_text',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.short-text@2","hints":"format","params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000},"minConfidence":0.97},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.short-text@2","hints":"format","params":{"maxOutputTokens":2048,"reasoning":"low","mediaResolution":"medium","timeoutMs":30000},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-text-default","version":1,"minReaders":2,"requireDistinctFamilies":true,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"autoAccept":true,"autoAcceptOutcomes":["correct","incorrect"],"auditSampleRate":0.1}'::jsonb,
 3, '7ead0000-0000-4000-8000-00000000000a', 'pipeline B: gemini-3.8-flash (umbral 0,97) + gpt-6-luna reasoning low (umbral 0,85); desarrollo con gemini-3.8-flash (etapa 1, T2)', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-00000000000b' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000013', NULL, 'active', 'format', 'multi_box',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.short-text@2","hints":"format","params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000},"minConfidence":0.97},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.short-text@2","hints":"format","params":{"maxOutputTokens":2048,"reasoning":"low","mediaResolution":"medium","timeoutMs":30000},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-text-default","version":1,"minReaders":2,"requireDistinctFamilies":true,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"autoAccept":true,"autoAcceptOutcomes":["correct","incorrect"],"auditSampleRate":0.1}'::jsonb,
 3, '7ead0000-0000-4000-8000-00000000000b', 'pipeline B: gemini-3.8-flash (umbral 0,97) + gpt-6-luna reasoning low (umbral 0,85); desarrollo con gemini-3.8-flash (etapa 1, T2)', now())
ON CONFLICT DO NOTHING;

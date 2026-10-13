UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-00000000000c' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000016', NULL, 'active', 'default', NULL,
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.short-answer@2","hints":"none","minConfidence":0.97,"params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000}},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.short-answer@2","hints":"none","minConfidence":0.85,"params":{"maxOutputTokens":2048,"reasoning":"low","mediaResolution":"medium","timeoutMs":30000}}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-default","version":1,"minReaders":2,"requireDistinctFamilies":true,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"maxOutputTokens":4096,"reasoning":"off","mediaResolution":"medium","timeoutMs":45000}},"autoAccept":true,"autoAcceptOutcomes":["correct","incorrect"],"auditSampleRate":0.1}'::jsonb,
 3, '7ead0000-0000-4000-8000-00000000000c', 'pipeline B + verificador de incorrectas gemini-3.8-flash (verify.incorrect@1, umbral 0,95) en las rutas que autoaceptan (etapa 1, T4)', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-00000000000f' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000017', NULL, 'active', 'format', 'sequence',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.boxes@1","hints":"format","minConfidence":0.97,"params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000}},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.boxes@1","hints":"format","minConfidence":0.85,"params":{"maxOutputTokens":2048,"reasoning":"low","mediaResolution":"medium","timeoutMs":30000}}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-default","version":1,"minReaders":2,"requireDistinctFamilies":true,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"maxOutputTokens":4096,"reasoning":"off","mediaResolution":"medium","timeoutMs":45000}},"autoAccept":true,"autoAcceptOutcomes":["correct","incorrect"],"auditSampleRate":0.1}'::jsonb,
 3, '7ead0000-0000-4000-8000-00000000000f', 'pipeline B + verificador de incorrectas gemini-3.8-flash (verify.incorrect@1, umbral 0,95) en las rutas que autoaceptan (etapa 1, T4)', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000010' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000018', NULL, 'active', 'format', 'ordered_tuple',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.short-answer@2","hints":"format","minConfidence":0.97,"params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000}},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.short-answer@2","hints":"format","minConfidence":0.85,"params":{"maxOutputTokens":2048,"reasoning":"low","mediaResolution":"medium","timeoutMs":30000}}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-default","version":1,"minReaders":2,"requireDistinctFamilies":true,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"maxOutputTokens":4096,"reasoning":"off","mediaResolution":"medium","timeoutMs":45000}},"autoAccept":true,"autoAcceptOutcomes":["correct","incorrect"],"auditSampleRate":0.1}'::jsonb,
 3, '7ead0000-0000-4000-8000-000000000010', 'pipeline B + verificador de incorrectas gemini-3.8-flash (verify.incorrect@1, umbral 0,95) en las rutas que autoaceptan (etapa 1, T4)', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000011' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000019', NULL, 'active', 'format', 'word_list',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.short-text@2","hints":"format","minConfidence":0.97,"params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000}},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.short-text@2","hints":"format","minConfidence":0.85,"params":{"maxOutputTokens":2048,"reasoning":"low","mediaResolution":"medium","timeoutMs":30000}}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-text-default","version":1,"minReaders":2,"requireDistinctFamilies":true,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"maxOutputTokens":4096,"reasoning":"off","mediaResolution":"medium","timeoutMs":45000}},"autoAccept":true,"autoAcceptOutcomes":["correct","incorrect"],"auditSampleRate":0.1}'::jsonb,
 4, '7ead0000-0000-4000-8000-000000000011', 'pipeline B + verificador de incorrectas gemini-3.8-flash (verify.incorrect@1, umbral 0,95) en las rutas que autoaceptan (etapa 1, T4)', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000012' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-00000000001a', NULL, 'active', 'format', 'short_text',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.short-text@2","hints":"format","minConfidence":0.97,"params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000}},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.short-text@2","hints":"format","minConfidence":0.85,"params":{"maxOutputTokens":2048,"reasoning":"low","mediaResolution":"medium","timeoutMs":30000}}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-text-default","version":1,"minReaders":2,"requireDistinctFamilies":true,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"maxOutputTokens":4096,"reasoning":"off","mediaResolution":"medium","timeoutMs":45000}},"autoAccept":true,"autoAcceptOutcomes":["correct","incorrect"],"auditSampleRate":0.1}'::jsonb,
 4, '7ead0000-0000-4000-8000-000000000012', 'pipeline B + verificador de incorrectas gemini-3.8-flash (verify.incorrect@1, umbral 0,95) en las rutas que autoaceptan (etapa 1, T4)', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000013' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-00000000001b', NULL, 'active', 'format', 'multi_box',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.short-text@2","hints":"format","minConfidence":0.97,"params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000}},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.short-text@2","hints":"format","minConfidence":0.85,"params":{"maxOutputTokens":2048,"reasoning":"low","mediaResolution":"medium","timeoutMs":30000}}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-text-default","version":1,"minReaders":2,"requireDistinctFamilies":true,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"maxOutputTokens":4096,"reasoning":"off","mediaResolution":"medium","timeoutMs":45000}},"autoAccept":true,"autoAcceptOutcomes":["correct","incorrect"],"auditSampleRate":0.1}'::jsonb,
 4, '7ead0000-0000-4000-8000-000000000013', 'pipeline B + verificador de incorrectas gemini-3.8-flash (verify.incorrect@1, umbral 0,95) en las rutas que autoaceptan (etapa 1, T4)', now())
ON CONFLICT DO NOTHING;

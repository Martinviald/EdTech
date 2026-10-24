ALTER TABLE "answer_readings" ADD COLUMN "interpretation" jsonb;
--> statement-breakpoint
-- Lectura interpretada (diseño v5): siguiente versión de las 6 rutas que autoaceptan de 0055. Los lectores
-- (gemini-3.8-flash >= 0,95 y gpt-6-luna low >= 0,85) usan transcribe.interpret@1 y devuelven lo escrito y la
-- respuesta que el alumno quiso dar; verifyAnswer la verifica; sin acuerdo desempata Jev (answer_reading_tiebreak)
-- solo si coincide con Gemini y confianza >= 0,9. Se retiran gpt-6.1-sol y el auditor de lectura; se mantiene el
-- verificador de incorrectas. Idempotente: retira solo si sigue activa e inserta con ON CONFLICT DO NOTHING.
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000022' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000028', NULL, 'active', 'default', NULL,
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.interpret@1","hints":"none","params":{"reasoning":"off","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.95},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.interpret@1","hints":"none","params":{"reasoning":"low","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-interpreted","agreeOn":"canonical","version":1,"autoAccept":true,"minReaders":2,"minConfidence":0.85,"onDisagreement":"review","tiebreakReader":null,"auditSampleRate":0.1,"blankByInkBelow":null,"autoAcceptOutcomes":["correct","incorrect"],"requireDistinctFamilies":true,"alternativePlausibilityFloor":0.2,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"reasoning":"off","timeoutMs":45000,"maxOutputTokens":4096,"mediaResolution":"medium"}},"readMode":"interpreted","decisionTiebreak":{"minConfidence":0.9,"agreeWithProvider":"gemini"}}'::jsonb,
 6, '7ead0000-0000-4000-8000-000000000022', 'Lectura interpretada (0057): transcribe.interpret@1, verifyAnswer, desempate Jev; sin sol ni auditor.', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000023' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000029', NULL, 'active', 'format', 'sequence',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"off","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.95},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"low","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-interpreted","agreeOn":"canonical","version":1,"autoAccept":true,"minReaders":2,"minConfidence":0.85,"onDisagreement":"review","tiebreakReader":null,"auditSampleRate":0.1,"blankByInkBelow":null,"autoAcceptOutcomes":["correct","incorrect"],"requireDistinctFamilies":true,"alternativePlausibilityFloor":0.2,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"reasoning":"off","timeoutMs":45000,"maxOutputTokens":4096,"mediaResolution":"medium"}},"readMode":"interpreted","decisionTiebreak":{"minConfidence":0.9,"agreeWithProvider":"gemini"}}'::jsonb,
 6, '7ead0000-0000-4000-8000-000000000023', 'Lectura interpretada (0057): transcribe.interpret@1, verifyAnswer, desempate Jev; sin sol ni auditor.', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000024' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-00000000002a', NULL, 'active', 'format', 'ordered_tuple',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"off","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.95},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"low","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-interpreted","agreeOn":"canonical","version":1,"autoAccept":true,"minReaders":2,"minConfidence":0.85,"onDisagreement":"review","tiebreakReader":null,"auditSampleRate":0.1,"blankByInkBelow":null,"autoAcceptOutcomes":["correct","incorrect"],"requireDistinctFamilies":true,"alternativePlausibilityFloor":0.2,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"reasoning":"off","timeoutMs":45000,"maxOutputTokens":4096,"mediaResolution":"medium"}},"readMode":"interpreted","decisionTiebreak":{"minConfidence":0.9,"agreeWithProvider":"gemini"}}'::jsonb,
 6, '7ead0000-0000-4000-8000-000000000024', 'Lectura interpretada (0057): transcribe.interpret@1, verifyAnswer, desempate Jev; sin sol ni auditor.', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000025' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-00000000002b', NULL, 'active', 'format', 'word_list',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"off","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.95},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"low","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-interpreted","agreeOn":"canonical","version":1,"autoAccept":true,"minReaders":2,"minConfidence":0.85,"onDisagreement":"review","tiebreakReader":null,"auditSampleRate":0.1,"blankByInkBelow":null,"autoAcceptOutcomes":["correct","incorrect"],"requireDistinctFamilies":true,"alternativePlausibilityFloor":0.2,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"reasoning":"off","timeoutMs":45000,"maxOutputTokens":4096,"mediaResolution":"medium"}},"readMode":"interpreted","decisionTiebreak":{"minConfidence":0.9,"agreeWithProvider":"gemini"}}'::jsonb,
 7, '7ead0000-0000-4000-8000-000000000025', 'Lectura interpretada (0057): transcribe.interpret@1, verifyAnswer, desempate Jev; sin sol ni auditor.', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000026' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-00000000002c', NULL, 'active', 'format', 'short_text',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"off","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.95},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"low","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-interpreted","agreeOn":"canonical","version":1,"autoAccept":true,"minReaders":2,"minConfidence":0.85,"onDisagreement":"review","tiebreakReader":null,"auditSampleRate":0.1,"blankByInkBelow":null,"autoAcceptOutcomes":["correct","incorrect"],"requireDistinctFamilies":true,"alternativePlausibilityFloor":0.2,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"reasoning":"off","timeoutMs":45000,"maxOutputTokens":4096,"mediaResolution":"medium"}},"readMode":"interpreted","decisionTiebreak":{"minConfidence":0.9,"agreeWithProvider":"gemini"}}'::jsonb,
 7, '7ead0000-0000-4000-8000-000000000026', 'Lectura interpretada (0057): transcribe.interpret@1, verifyAnswer, desempate Jev; sin sol ni auditor.', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000027' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-00000000002d', NULL, 'active', 'format', 'multi_box',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"off","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.95},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"low","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-interpreted","agreeOn":"canonical","version":1,"autoAccept":true,"minReaders":2,"minConfidence":0.85,"onDisagreement":"review","tiebreakReader":null,"auditSampleRate":0.1,"blankByInkBelow":null,"autoAcceptOutcomes":["correct","incorrect"],"requireDistinctFamilies":true,"alternativePlausibilityFloor":0.2,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"reasoning":"off","timeoutMs":45000,"maxOutputTokens":4096,"mediaResolution":"medium"}},"readMode":"interpreted","decisionTiebreak":{"minConfidence":0.9,"agreeWithProvider":"gemini"}}'::jsonb,
 7, '7ead0000-0000-4000-8000-000000000027', 'Lectura interpretada (0057): transcribe.interpret@1, verifyAnswer, desempate Jev; sin sol ni auditor.', now())
ON CONFLICT DO NOTHING;

-- Reglas de recuperación de la lectura interpretada: siguiente versión de las 6 rutas de 0057 con
-- policy.recoveryRules prendidas. Sin acuerdo después del desempate, matching_column (pareo: los dos lectores
-- apuntan a un único código y es el mismo) y luego key_anchor (Gemini sobre su umbral verifica una respuesta
-- única que la corrección da por correcta, sin variante confundible 1↔7/4 en el otro lector). Lo recuperado
-- sigue pasando por la política de aceptación y el verificador de incorrectas. Sin cambios de esquema.
-- Idempotente: retira solo si sigue activa e inserta con ON CONFLICT DO NOTHING.
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000028' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-00000000002e', NULL, 'active', 'default', NULL,
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.interpret@1","hints":"none","params":{"reasoning":"off","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.95},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.interpret@1","hints":"none","params":{"reasoning":"low","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-interpreted","agreeOn":"canonical","version":1,"autoAccept":true,"minReaders":2,"minConfidence":0.85,"onDisagreement":"review","tiebreakReader":null,"auditSampleRate":0.1,"blankByInkBelow":null,"autoAcceptOutcomes":["correct","incorrect"],"requireDistinctFamilies":true,"alternativePlausibilityFloor":0.2,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"reasoning":"off","timeoutMs":45000,"maxOutputTokens":4096,"mediaResolution":"medium"}},"readMode":"interpreted","decisionTiebreak":{"minConfidence":0.9,"agreeWithProvider":"gemini"},"recoveryRules":{"matchingColumn":true,"keyAnchor":{"provider":"gemini"}}}'::jsonb,
 7, '7ead0000-0000-4000-8000-000000000028', 'Reglas de recuperación (0058): matching_column y key_anchor (gemini) sin acuerdo tras el desempate.', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-000000000029' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-00000000002f', NULL, 'active', 'format', 'sequence',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"off","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.95},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"low","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-interpreted","agreeOn":"canonical","version":1,"autoAccept":true,"minReaders":2,"minConfidence":0.85,"onDisagreement":"review","tiebreakReader":null,"auditSampleRate":0.1,"blankByInkBelow":null,"autoAcceptOutcomes":["correct","incorrect"],"requireDistinctFamilies":true,"alternativePlausibilityFloor":0.2,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"reasoning":"off","timeoutMs":45000,"maxOutputTokens":4096,"mediaResolution":"medium"}},"readMode":"interpreted","decisionTiebreak":{"minConfidence":0.9,"agreeWithProvider":"gemini"},"recoveryRules":{"matchingColumn":true,"keyAnchor":{"provider":"gemini"}}}'::jsonb,
 7, '7ead0000-0000-4000-8000-000000000029', 'Reglas de recuperación (0058): matching_column y key_anchor (gemini) sin acuerdo tras el desempate.', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-00000000002a' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000030', NULL, 'active', 'format', 'ordered_tuple',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"off","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.95},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"low","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-interpreted","agreeOn":"canonical","version":1,"autoAccept":true,"minReaders":2,"minConfidence":0.85,"onDisagreement":"review","tiebreakReader":null,"auditSampleRate":0.1,"blankByInkBelow":null,"autoAcceptOutcomes":["correct","incorrect"],"requireDistinctFamilies":true,"alternativePlausibilityFloor":0.2,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"reasoning":"off","timeoutMs":45000,"maxOutputTokens":4096,"mediaResolution":"medium"}},"readMode":"interpreted","decisionTiebreak":{"minConfidence":0.9,"agreeWithProvider":"gemini"},"recoveryRules":{"matchingColumn":true,"keyAnchor":{"provider":"gemini"}}}'::jsonb,
 7, '7ead0000-0000-4000-8000-00000000002a', 'Reglas de recuperación (0058): matching_column y key_anchor (gemini) sin acuerdo tras el desempate.', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-00000000002b' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000031', NULL, 'active', 'format', 'word_list',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"off","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.95},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"low","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-interpreted","agreeOn":"canonical","version":1,"autoAccept":true,"minReaders":2,"minConfidence":0.85,"onDisagreement":"review","tiebreakReader":null,"auditSampleRate":0.1,"blankByInkBelow":null,"autoAcceptOutcomes":["correct","incorrect"],"requireDistinctFamilies":true,"alternativePlausibilityFloor":0.2,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"reasoning":"off","timeoutMs":45000,"maxOutputTokens":4096,"mediaResolution":"medium"}},"readMode":"interpreted","decisionTiebreak":{"minConfidence":0.9,"agreeWithProvider":"gemini"},"recoveryRules":{"matchingColumn":true,"keyAnchor":{"provider":"gemini"}}}'::jsonb,
 8, '7ead0000-0000-4000-8000-00000000002b', 'Reglas de recuperación (0058): matching_column y key_anchor (gemini) sin acuerdo tras el desempate.', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-00000000002c' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000032', NULL, 'active', 'format', 'short_text',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"off","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.95},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"low","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-interpreted","agreeOn":"canonical","version":1,"autoAccept":true,"minReaders":2,"minConfidence":0.85,"onDisagreement":"review","tiebreakReader":null,"auditSampleRate":0.1,"blankByInkBelow":null,"autoAcceptOutcomes":["correct","incorrect"],"requireDistinctFamilies":true,"alternativePlausibilityFloor":0.2,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"reasoning":"off","timeoutMs":45000,"maxOutputTokens":4096,"mediaResolution":"medium"}},"readMode":"interpreted","decisionTiebreak":{"minConfidence":0.9,"agreeWithProvider":"gemini"},"recoveryRules":{"matchingColumn":true,"keyAnchor":{"provider":"gemini"}}}'::jsonb,
 8, '7ead0000-0000-4000-8000-00000000002c', 'Reglas de recuperación (0058): matching_column y key_anchor (gemini) sin acuerdo tras el desempate.', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reading_routes" SET "status" = 'retired', "retired_at" = now(), "updated_at" = now()
WHERE "id" = '7ead0000-0000-4000-8000-00000000002d' AND "status" = 'active';
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "supersedes_id", "notes", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000033', NULL, 'active', 'format', 'multi_box',
 '[{"key":"gemini-3.8-flash","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"off","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.95},{"key":"gpt-6-luna","transcriberId":"llm","provider":"openai","family":"openai-luna","model":"gpt-6-luna","promptRef":"transcribe.interpret@1","hints":"format","params":{"reasoning":"low","timeoutMs":30000,"maxOutputTokens":2048,"mediaResolution":"medium"},"minConfidence":0.85}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-interpreted","agreeOn":"canonical","version":1,"autoAccept":true,"minReaders":2,"minConfidence":0.85,"onDisagreement":"review","tiebreakReader":null,"auditSampleRate":0.1,"blankByInkBelow":null,"autoAcceptOutcomes":["correct","incorrect"],"requireDistinctFamilies":true,"alternativePlausibilityFloor":0.2,"incorrectVerifier":{"key":"gemini-3.8-flash-verificador","transcriberId":"llm","provider":"gemini","family":"gemini-flash","model":"gemini-3.8-flash","promptRef":"verify.incorrect@1","hints":"format","minConfidence":0.95,"params":{"reasoning":"off","timeoutMs":45000,"maxOutputTokens":4096,"mediaResolution":"medium"}},"readMode":"interpreted","decisionTiebreak":{"minConfidence":0.9,"agreeWithProvider":"gemini"},"recoveryRules":{"matchingColumn":true,"keyAnchor":{"provider":"gemini"}}}'::jsonb,
 8, '7ead0000-0000-4000-8000-00000000002d', 'Reglas de recuperación (0058): matching_column y key_anchor (gemini) sin acuerdo tras el desempate.', now())
ON CONFLICT DO NOTHING;

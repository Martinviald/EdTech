INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000002', NULL, 'active', 'format', 'word_list',
 '[{"key":"claude-haiku-5-5","transcriberId":"llm","provider":"anthropic","family":"anthropic-haiku","model":"claude-haiku-5-5","promptRef":"transcribe.short-text@1","hints":"none","params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000}},{"key":"gemini-3.5-flash-lite","transcriberId":"llm","provider":"gemini","family":"gemini-flash-lite","model":"gemini-3.5-flash-lite","promptRef":"transcribe.short-text@1","hints":"none","params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000}}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-text-default","version":1,"minReaders":2,"requireDistinctFamilies":true,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"autoAccept":true,"autoAcceptOutcomes":["correct","incorrect"],"auditSampleRate":0.1}'::jsonb,
 1, now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000003', NULL, 'active', 'format', 'short_text',
 '[{"key":"claude-haiku-5-5","transcriberId":"llm","provider":"anthropic","family":"anthropic-haiku","model":"claude-haiku-5-5","promptRef":"transcribe.short-text@1","hints":"none","params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000}},{"key":"gemini-3.5-flash-lite","transcriberId":"llm","provider":"gemini","family":"gemini-flash-lite","model":"gemini-3.5-flash-lite","promptRef":"transcribe.short-text@1","hints":"none","params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000}}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-text-default","version":1,"minReaders":2,"requireDistinctFamilies":true,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"autoAccept":true,"autoAcceptOutcomes":["correct","incorrect"],"auditSampleRate":0.1}'::jsonb,
 1, now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000004', NULL, 'active', 'format', 'multi_box',
 '[{"key":"claude-haiku-5-5","transcriberId":"llm","provider":"anthropic","family":"anthropic-haiku","model":"claude-haiku-5-5","promptRef":"transcribe.short-text@1","hints":"none","params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000}},{"key":"gemini-3.5-flash-lite","transcriberId":"llm","provider":"gemini","family":"gemini-flash-lite","model":"gemini-3.5-flash-lite","promptRef":"transcribe.short-text@1","hints":"none","params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000}}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-text-default","version":1,"minReaders":2,"requireDistinctFamilies":true,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"autoAccept":true,"autoAcceptOutcomes":["correct","incorrect"],"auditSampleRate":0.1}'::jsonb,
 1, now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000005', NULL, 'active', 'format', 'free_text',
 '[{"key":"claude-haiku-5-5","transcriberId":"llm","provider":"anthropic","family":"anthropic-haiku","model":"claude-haiku-5-5","promptRef":"transcribe.free-text@1","hints":"none","params":{"maxOutputTokens":4096,"reasoning":"off","mediaResolution":"medium","timeoutMs":60000}}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"free-text-default","version":1,"minReaders":1,"requireDistinctFamilies":false,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"autoAccept":false,"autoAcceptOutcomes":[],"auditSampleRate":0}'::jsonb,
 1, now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "format_kind", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000006', NULL, 'active', 'format', 'math_work',
 '[{"key":"claude-haiku-5-5","transcriberId":"llm","provider":"anthropic","family":"anthropic-haiku","model":"claude-haiku-5-5","promptRef":"transcribe.free-text@1","hints":"none","params":{"maxOutputTokens":4096,"reasoning":"off","mediaResolution":"medium","timeoutMs":60000}}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"free-text-default","version":1,"minReaders":1,"requireDistinctFamilies":false,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"autoAccept":false,"autoAcceptOutcomes":[],"auditSampleRate":0}'::jsonb,
 1, now())
ON CONFLICT DO NOTHING;

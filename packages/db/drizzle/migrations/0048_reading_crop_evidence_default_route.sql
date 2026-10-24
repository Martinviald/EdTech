ALTER TABLE "sheet_scan_marks" ADD COLUMN "crop_evidence" jsonb;--> statement-breakpoint
INSERT INTO "reading_routes" ("id", "org_id", "status", "level", "readers", "fallback_readers", "shadow_readers", "shadow_sample_rate", "policy", "version", "activated_at")
VALUES ('7ead0000-0000-4000-8000-000000000001', NULL, 'active', 'default',
 '[{"key":"claude-haiku-5-5","transcriberId":"llm","provider":"anthropic","family":"anthropic-haiku","model":"claude-haiku-5-5","promptRef":"transcribe.short-answer@2","hints":"none","params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000}},{"key":"gemini-3.5-flash-lite","transcriberId":"llm","provider":"gemini","family":"gemini-flash-lite","model":"gemini-3.5-flash-lite","promptRef":"transcribe.short-answer@2","hints":"none","params":{"maxOutputTokens":2048,"reasoning":"off","mediaResolution":"medium","timeoutMs":30000}}]'::jsonb,
 '[]'::jsonb, '[]'::jsonb, 0,
 '{"id":"short-answer-default","version":1,"minReaders":2,"requireDistinctFamilies":true,"agreeOn":"canonical","minConfidence":0.85,"alternativePlausibilityFloor":0.2,"blankByInkBelow":null,"onDisagreement":"review","tiebreakReader":null,"autoAccept":true,"autoAcceptOutcomes":["correct","incorrect"],"auditSampleRate":0.1}'::jsonb,
 1, now())
ON CONFLICT DO NOTHING;

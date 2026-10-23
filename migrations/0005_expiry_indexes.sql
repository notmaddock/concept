CREATE INDEX IF NOT EXISTS "session_expiresAt_idx" ON "session" ("expiresAt");
CREATE INDEX IF NOT EXISTS "verification_expiresAt_idx" ON "verification" ("expiresAt");

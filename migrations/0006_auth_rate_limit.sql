-- Better Auth 1.7 database rate limiter. The unique key arbitrates concurrent
-- first requests; conditional UPDATE ... RETURNING arbitrates increments/resets.
CREATE TABLE rateLimit (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  lastRequest INTEGER NOT NULL
);

-- Better Auth prunes expired counters when resetting an expired bucket.
CREATE INDEX rateLimit_lastRequest_idx ON rateLimit (lastRequest);

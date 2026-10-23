CREATE TABLE "passkey" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT,
  "publicKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "credentialID" TEXT NOT NULL,
  "counter" INTEGER NOT NULL,
  "deviceType" TEXT NOT NULL,
  "backedUp" INTEGER NOT NULL,
  "transports" TEXT,
  "createdAt" INTEGER,
  "aaguid" TEXT
);
CREATE INDEX "passkey_userId_idx" ON "passkey" ("userId");
CREATE UNIQUE INDEX "passkey_credentialID_idx" ON "passkey" ("credentialID");

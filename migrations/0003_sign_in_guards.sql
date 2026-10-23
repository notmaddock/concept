-- Keep this invariant in D1 so concurrent unlink/delete requests cannot lock out a user.
CREATE TRIGGER "account_keep_sign_in_method"
BEFORE DELETE ON "account"
WHEN EXISTS (SELECT 1 FROM "user" WHERE "id" = OLD."userId")
  AND NOT EXISTS (SELECT 1 FROM "account" WHERE "userId" = OLD."userId" AND "id" != OLD."id")
  AND NOT EXISTS (SELECT 1 FROM "passkey" WHERE "userId" = OLD."userId")
BEGIN
  SELECT RAISE(ABORT, 'Add another sign-in method before removing this one.');
END;

CREATE TRIGGER "passkey_keep_sign_in_method"
BEFORE DELETE ON "passkey"
WHEN EXISTS (SELECT 1 FROM "user" WHERE "id" = OLD."userId")
  AND NOT EXISTS (SELECT 1 FROM "passkey" WHERE "userId" = OLD."userId" AND "id" != OLD."id")
  AND NOT EXISTS (SELECT 1 FROM "account" WHERE "userId" = OLD."userId")
BEGIN
  SELECT RAISE(ABORT, 'Add another sign-in method before removing this one.');
END;

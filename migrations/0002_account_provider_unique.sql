-- Better-auth's canonical schema keeps at most one account row per (providerId, accountId).
-- 0001 lacked the unique index, so a double-submitted OAuth callback could insert duplicates
-- and later token lookups would resolve to an arbitrary row. Keep the newest row before adding it.
delete from "account"
where "id" in (
  select a."id"
  from "account" a
  join "account" b
    on b."providerId" = a."providerId"
   and b."accountId" = a."accountId"
   and (
    b."updatedAt" > a."updatedAt"
    or (b."updatedAt" = a."updatedAt" and b.rowid > a.rowid)
  )
);

create unique index "account_providerId_accountId_unique"
  on "account" ("providerId", "accountId");

create table "public_drive_publisher" (
  "fileId" text not null primary key,
  "userId" text not null references "user" ("id") on delete cascade,
  "accountId" text not null references "account" ("id") on delete cascade,
  "resourceKey" text,
  "updatedAt" integer not null
);

create table "public_drive_publisher_epoch" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "version" integer not null default 0
);

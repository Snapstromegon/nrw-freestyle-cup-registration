-- Baseline schema for the 2027 season.
--
-- Squashes the 2024-2026 migrations (archived in migrations-archive/2024-2026)
-- into the resulting schema. This migration only creates tables and views and
-- inserts no data: the competition, categories and timeplan are seeded from the
-- config file on startup (see src/seed.rs).

-- An event. For now the app uses one competition at a time (the one with the
-- latest start_date); the id allows adding support for multiple events later.
CREATE TABLE "competition" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  -- Ages (and with that categories) are calculated against this day.
  "determining_day" DATE NOT NULL,
  "registration_start" DATETIME NOT NULL,
  "registration_end" DATETIME NOT NULL,
  "music_upload_end" DATETIME NOT NULL,
  "fee_per_start" REAL NOT NULL,
  -- NULL means no cap.
  "max_fee_per_starter" REAL,
  "payment_deadline" DATE,
  "payment_account_holder" TEXT,
  "payment_iban" TEXT,
  "payment_bic" TEXT,
  -- Prefix for the transfer reference, followed by the club name.
  "payment_reference" TEXT
);

CREATE TABLE "users" (
  "id" BLOB PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "email_verified" BOOLEAN NOT NULL,
  "name" TEXT NOT NULL UNIQUE,
  "password" TEXT NOT NULL,
  "is_admin" BOOLEAN NOT NULL,
  "club_id" BLOB
);

CREATE TABLE "mail_verification" (
  "id" BLOB PRIMARY KEY,
  "user_id" BLOB NOT NULL,
  "created_at" TIMESTAMP NOT NULL,
  FOREIGN KEY ("user_id") REFERENCES "users" ("id")
);

CREATE TABLE "password_resets" (
  "id" BLOB PRIMARY KEY,
  "user_id" BLOB NOT NULL,
  "created_at" TIMESTAMP NOT NULL,
  FOREIGN KEY ("user_id") REFERENCES "users" ("id")
);

CREATE TABLE "clubs" (
  "id" BLOB PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "owner_id" BLOB NOT NULL,
  "payment" REAL,
  FOREIGN KEY ("owner_id") REFERENCES "users" ("id")
);

CREATE TABLE "starter" (
  "id" BLOB PRIMARY KEY,
  "club_id" BLOB NOT NULL,
  "firstname" TEXT NOT NULL,
  "lastname" TEXT NOT NULL,
  "birthdate" DATETIME NOT NULL,
  "single_male" BOOLEAN NOT NULL,
  "single_female" BOOLEAN NOT NULL,
  "pair" BOOLEAN NOT NULL,
  "partner_id" BLOB,
  "partner_name" TEXT,
  FOREIGN KEY ("club_id") REFERENCES "clubs" ("id"),
  FOREIGN KEY ("partner_id") REFERENCES "starter" ("id"),
  CONSTRAINT "unique_name" UNIQUE ("club_id", "firstname", "lastname"),
  -- A rider can only start in one single act.
  CONSTRAINT "one_single" CHECK (NOT ("single_male" AND "single_female"))
);

CREATE TABLE "acts" (
  "id" BLOB PRIMARY KEY,
  "name" TEXT NOT NULL,
  "song_file" TEXT,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "description" TEXT,
  "song_file_name" TEXT,
  -- The group values are reserved for group acts, so adding them later needs no table rebuild.
  "act_type" TEXT NOT NULL CHECK ("act_type" IN ('single', 'pair', 'group_small', 'group_large')),
  "song_checked" BOOLEAN NOT NULL DEFAULT FALSE,
  "order" INTEGER,
  "started_at" DATETIME,
  "ended_at" DATETIME
);

CREATE TABLE "act_participants" (
  "act_id" BLOB NOT NULL,
  "starter_id" BLOB NOT NULL,
  FOREIGN KEY ("act_id") REFERENCES "acts" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("starter_id") REFERENCES "starter" ("id"),
  PRIMARY KEY ("act_id", "starter_id")
);

CREATE TABLE "categories" (
  "name" TEXT PRIMARY KEY,
  "description" TEXT,
  "from_birthday" DATETIME,
  "to_birthday" DATETIME,
  "act_type" TEXT NOT NULL CHECK ("act_type" IN ('single', 'pair', 'group_small', 'group_large')),
  "is_single_male" BOOLEAN NOT NULL DEFAULT FALSE,
  "order" INTEGER,
  "einfahrzeit_seconds" INTEGER NOT NULL DEFAULT 0,
  "act_duration_seconds" INTEGER NOT NULL DEFAULT 0,
  "judge_duration_seconds" INTEGER NOT NULL DEFAULT 0
);

-- A timeplan entry is either a reference to a category or a custom entry
-- If it is a reference to a category, the category field is set
-- If it is a custom entry, the category field is NULL and a label and duration_seconds field is set
-- The earliest_start_time is the earliest time the timeplan entry can start
CREATE TABLE "timeplan" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "earliest_start_time" DATETIME,
  "duration_seconds" INTEGER,
  "label" TEXT,
  "category" TEXT,
  "started_at" DATETIME,
  "ended_at" DATETIME,
  FOREIGN KEY ("category") REFERENCES "categories" ("name")
);

CREATE VIEW
  view_act AS
SELECT
  a.*,
  (
    SELECT
      MAX(
        (
          julianday (
            (
              SELECT determining_day FROM competition ORDER BY start_date DESC LIMIT 1
            )
          ) - julianday (s.birthdate)
        ) / 365.2425
      )
    FROM
      starter s
      JOIN act_participants p ON p.starter_id = s.id
    WHERE
      p.act_id = a.id
  ) AS max_age,
  (
    SELECT
      json_group_array (
        json_object (
          'firstname',
          starter.firstname,
          'lastname',
          starter.lastname,
          'id',
          hex (starter.id),
          'club_name',
          clubs.name
        )
      )
    FROM
      starter
      JOIN act_participants p ON p.starter_id = starter.id
      JOIN clubs ON clubs.id = starter.club_id
    WHERE
      p.act_id = a.id
  ) AS participants,
  (
    SELECT
      categories.name
    FROM
      categories
    WHERE
      categories.act_type = a.act_type
      -- Single categories are split by gender; other act types aren't.
      AND (
        a.act_type != 'single'
        OR categories.is_single_male = (
          SELECT
            MIN(s.single_male)
          FROM
            starter s
            JOIN act_participants p ON p.starter_id = s.id
          WHERE
            p.act_id = a.id
        )
      )
      AND categories.from_birthday <= (
        SELECT
          MIN(s.birthdate)
        FROM
          starter s
          JOIN act_participants p ON p.starter_id = s.id
        WHERE
          p.act_id = a.id
      )
      AND categories.to_birthday > (
        SELECT
          MIN(s.birthdate)
        FROM
          starter s
          JOIN act_participants p ON p.starter_id = s.id
        WHERE
          p.act_id = a.id
      )
    LIMIT
      1
  ) AS category
FROM
  acts a;

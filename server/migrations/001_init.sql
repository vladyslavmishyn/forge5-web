-- Forge5 portal: initial schema.

CREATE TABLE settings (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  phase       text NOT NULL DEFAULT 'reg' CHECK (phase IN ('reg', 'build', 'vote', 'result')),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (id) VALUES (true);

CREATE TABLE users (
  id                  bigserial PRIMARY KEY,
  name                text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  email               text NOT NULL UNIQUE CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  college             text NOT NULL CHECK (char_length(college) BETWEEN 1 AND 80),
  major               text NOT NULL DEFAULT 'Undeclared' CHECK (char_length(major) BETWEEN 1 AND 80),
  skills              text[] NOT NULL DEFAULT '{}' CHECK (cardinality(skills) <= 20),
  diet                text NOT NULL DEFAULT '' CHECK (char_length(diet) <= 120),
  wants_team          boolean NOT NULL DEFAULT false,
  accepted_ai_policy  boolean NOT NULL CHECK (accepted_ai_policy),
  accepted_waiver     boolean NOT NULL CHECK (accepted_waiver),
  email_verified_at   timestamptz,
  project_id          bigint,
  team_joined_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id          bigserial PRIMARY KEY,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  blurb       text NOT NULL CHECK (char_length(blurb) BETWEEN 1 AND 280),
  fields      text[] NOT NULL CHECK (cardinality(fields) BETWEEN 2 AND 7),
  cap         int NOT NULL CHECK (cap BETWEEN 2 AND 5),
  need        text NOT NULL DEFAULT '' CHECK (char_length(need) <= 120),
  created_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD CONSTRAINT users_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX users_project_id_idx ON users (project_id);

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     bigint REFERENCES users(id) ON DELETE CASCADE,
  is_admin    boolean NOT NULL DEFAULT false,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (is_admin OR user_id IS NOT NULL)
);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE login_tokens (
  token_hash  text PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('signin', 'confirm')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_tokens_expires_at_idx ON login_tokens (expires_at);

CREATE TABLE equipment (
  key          text PRIMARY KEY,
  name         text NOT NULL,
  stock_total  int NOT NULL CHECK (stock_total >= 0),
  sort         int NOT NULL DEFAULT 0
);
INSERT INTO equipment (key, name, stock_total, sort) VALUES
  ('esp32', 'ESP32 dev board',        24,  1),
  ('bread', 'Breadboard',             30,  2),
  ('jump',  'Jumper wire pack',       28,  3),
  ('led',   'LED assortment',         40,  4),
  ('diode', 'Diode pack',             22,  5),
  ('temp',  'Temp / humidity sensor', 16,  6),
  ('pir',   'Motion (PIR) sensor',    12,  7),
  ('ultra', 'Ultrasonic ranger',      10,  8),
  ('mic',   'Microphone module',       8,  9),
  ('batt',  'Battery pack',           18, 10),
  ('usb',   'USB-C cable',            26, 11),
  ('mark',  'Marker + card set',      35, 12);

CREATE TABLE equipment_requests (
  id            bigserial PRIMARY KEY,
  project_id    bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  returned_at   timestamptz
);
CREATE INDEX equipment_requests_project_id_idx ON equipment_requests (project_id);

CREATE TABLE equipment_request_items (
  request_id     bigint NOT NULL REFERENCES equipment_requests(id) ON DELETE CASCADE,
  equipment_key  text NOT NULL REFERENCES equipment(key),
  qty            int NOT NULL CHECK (qty BETWEEN 1 AND 999),
  PRIMARY KEY (request_id, equipment_key)
);
CREATE INDEX equipment_request_items_key_idx ON equipment_request_items (equipment_key);

CREATE TABLE ballots (
  user_id     bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ballot_votes (
  user_id     bigint NOT NULL REFERENCES ballots(user_id) ON DELETE CASCADE,
  project_id  bigint NOT NULL REFERENCES projects(id),
  PRIMARY KEY (user_id, project_id)
);
CREATE INDEX ballot_votes_project_id_idx ON ballot_votes (project_id);

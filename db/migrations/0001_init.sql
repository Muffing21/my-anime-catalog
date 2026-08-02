CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  username      text UNIQUE NOT NULL,
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS anime (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  anilist_id       integer UNIQUE NOT NULL,
  title_romaji     text,
  title_english    text,
  title_native     text,
  cover_image_url  text,
  banner_image_url text,
  synopsis         text,
  episode_count    integer,
  format           text,
  status           text,
  season           text,
  year             integer,
  average_score    integer,
  genres           jsonb,
  cached_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS list_entries (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anime_id    uuid NOT NULL REFERENCES anime(id),
  status      text NOT NULL CHECK (status IN ('watching','completed','on_hold','dropped','plan_to_watch')),
  score       integer CHECK (score BETWEEN 1 AND 10),
  progress    integer NOT NULL DEFAULT 0,
  started_at  date,
  finished_at date,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, anime_id)
);
CREATE INDEX IF NOT EXISTS idx_list_entries_user_id ON list_entries(user_id);

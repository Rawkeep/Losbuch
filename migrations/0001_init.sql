-- Losbuch D1-Schema
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,            -- öffentliche Konto-ID
  token TEXT NOT NULL UNIQUE,     -- Pairing-Token (Bearer)
  name TEXT,
  state TEXT,                     -- Bundesland (Annahmeschluss)
  active TEXT NOT NULL DEFAULT '{}', -- JSON {lotto:true,…}
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS docs (                 -- Scheine, Ergebnisse, Gruppen – generischer Sync-Speicher
  account_id TEXT NOT NULL,
  coll TEXT NOT NULL,             -- tickets | results | groups
  id TEXT NOT NULL,
  data TEXT NOT NULL,             -- JSON
  updated_at INTEGER NOT NULL,    -- Lamport-/Wallclock-Zeit für Sync
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, coll, id)
);
CREATE INDEX IF NOT EXISTS docs_sync ON docs(account_id, updated_at);
CREATE TABLE IF NOT EXISTS draws (                -- Ziehungen sind global (für alle Konten gleich)
  id TEXT PRIMARY KEY,            -- game_YYYY-MM-DD
  game TEXT NOT NULL,
  date TEXT NOT NULL,
  data TEXT NOT NULL,             -- JSON wie in rules.evaluate erwartet
  source TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS draws_date ON draws(date);
CREATE TABLE IF NOT EXISTS push_subs (
  account_id TEXT NOT NULL,
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notified (             -- verhindert doppelte Push-Nachrichten
  account_id TEXT NOT NULL,
  draw_id TEXT NOT NULL,
  PRIMARY KEY (account_id, draw_id)
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); -- VAPID-Schlüssel, Cron-Log

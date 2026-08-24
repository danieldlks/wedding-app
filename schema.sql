CREATE TABLE IF NOT EXISTS households (
  invite_code TEXT PRIMARY KEY,
  household_name TEXT NOT NULL,
  members TEXT NOT NULL,        -- JSON array: [{ id, name }]
  invited_events TEXT NOT NULL, -- JSON array of event ids
  allow_plus_one INTEGER NOT NULL DEFAULT 0,
  personal_note TEXT,
  created_at TEXT NOT NULL,
  response TEXT                 -- JSON object, or NULL until the guest submits
);

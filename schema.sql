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

-- Reception floor plan: one row per table the admin places on the seat-map canvas.
CREATE TABLE IF NOT EXISTS seating_tables (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  shape TEXT NOT NULL DEFAULT 'round', -- 'round' | 'rect'
  x REAL NOT NULL DEFAULT 100,         -- position in floor-plan units (0-1000 x, 0-700 y)
  y REAL NOT NULL DEFAULT 100,
  size REAL NOT NULL DEFAULT 90,       -- diameter (round) or width (rect)
  rotation REAL NOT NULL DEFAULT 0,    -- degrees, rect only
  capacity INTEGER NOT NULL DEFAULT 8,
  created_at TEXT NOT NULL
);

-- Per-seat assignment, one row per invited guest (member_id from a
-- household's members JSON). seat_index (0-based) picks a specific chair
-- around the table, using the same layout formula the canvas draws with —
-- see getSeatPositions() in src/App.jsx. (member_id, table_id, seat_index)
-- isn't a compound key: member_id alone is the PK since a guest sits in
-- exactly one seat; seat uniqueness within a table is enforced in
-- functions/api/admin.js before insert.
CREATE TABLE IF NOT EXISTS seat_assignments (
  member_id TEXT PRIMARY KEY,
  invite_code TEXT NOT NULL,
  table_id TEXT NOT NULL,
  seat_index INTEGER NOT NULL DEFAULT 0,
  assigned_at TEXT NOT NULL
);

-- Non-seating floor plan landmarks (bar, doors, dance floor, barriers/walls)
-- so the seat map reads as an actual room instead of tables floating in
-- space. No capacity/assignment logic — just a shape, a free-text label, and
-- a position — so unlike seating_tables, these are safe to show to every
-- guest regardless of where they're sitting. 'line' uses (x,y)-(x2,y2) as
-- its two endpoints (for angled walls/barriers) and ignores `size`; the
-- other three shapes use (x,y) as center and `size` as diameter/side length.
CREATE TABLE IF NOT EXISTS floor_objects (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,   -- 'circle' | 'rect' | 'triangle' | 'line'
  label TEXT,
  x REAL NOT NULL DEFAULT 100,
  y REAL NOT NULL DEFAULT 100,
  size REAL NOT NULL DEFAULT 60,
  x2 REAL,
  y2 REAL,
  created_at TEXT NOT NULL
);

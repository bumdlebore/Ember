CREATE TABLE IF NOT EXISTS entries (
  owner   TEXT    NOT NULL,
  id      TEXT    NOT NULL,
  data    TEXT    NOT NULL,
  u       INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, id)
);
CREATE INDEX IF NOT EXISTS idx_entries_owner_u ON entries(owner, u);

CREATE TABLE sidebar_layouts (
  container_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sidebar_positions (
  container_id TEXT NOT NULL REFERENCES sidebar_layouts(container_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (container_id, item_id),
  UNIQUE (container_id, position)
);

CREATE INDEX idx_sidebar_positions_order
  ON sidebar_positions(container_id, position);

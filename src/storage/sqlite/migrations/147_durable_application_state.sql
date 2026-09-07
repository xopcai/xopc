CREATE TABLE durable_state (
  namespace TEXT NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  UNIQUE(namespace, scope, key)
);
CREATE TABLE workflow_events (
  agent_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  id TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(agent_id, run_id, sequence)
);
CREATE TABLE note_snapshots (
  note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
  timestamp INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(note_id, timestamp)
);
CREATE TABLE durable_messages (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  queue TEXT NOT NULL,
  scope TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  enqueued_at INTEGER NOT NULL,
  processed_at INTEGER,
  lease_token TEXT,
  lease_until INTEGER,
  UNIQUE(queue, scope, id)
);
CREATE INDEX durable_messages_pending ON durable_messages(queue, scope, processed_at, sequence);

CREATE UNIQUE INDEX durable_share_token ON durable_state(namespace, json_extract(payload, '$.token'))
  WHERE namespace IN ('shares', 'site-shares');
CREATE UNIQUE INDEX durable_site_subdomain ON durable_state(json_extract(payload, '$.subdomain'))
  WHERE namespace = 'site-shares' AND json_extract(payload, '$.subdomain') IS NOT NULL;

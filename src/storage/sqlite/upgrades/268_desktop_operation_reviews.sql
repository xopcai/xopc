CREATE TABLE desktop_operation_reviews (
  operation_id TEXT PRIMARY KEY REFERENCES capability_operations(operation_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  review_id TEXT NOT NULL UNIQUE,
  generation INTEGER NOT NULL CHECK (generation > 0),
  intent_fingerprint TEXT NOT NULL,
  observation_json TEXT NOT NULL CHECK (json_valid(observation_json)),
  created_at INTEGER NOT NULL
);

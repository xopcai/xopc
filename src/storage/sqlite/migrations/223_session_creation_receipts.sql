UPDATE sessions SET custom_data_json=json_remove(custom_data_json, '$.genericNewChatShell')
WHERE json_type(custom_data_json, '$.genericNewChatShell') IS NOT NULL;

CREATE TABLE session_input_receipts (
  conversation_id TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  input_id TEXT,
  transcript_id TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, client_message_id)
);

CREATE TABLE session_tombstones (
  conversation_id TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);

CREATE TABLE session_preparation_retries (
  conversation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  principal_id TEXT NOT NULL,
  PRIMARY KEY (conversation_id, idempotency_key)
);

CREATE TABLE session_preparations (
  conversation_id TEXT PRIMARY KEY REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL UNIQUE,
  creation_json TEXT NOT NULL CHECK(json_valid(creation_json)),
  state TEXT NOT NULL CHECK(state IN ('preparing', 'ready', 'preparation_failed')),
  environment_id TEXT NOT NULL,
  base_commit TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE session_preparation_cleanup (
  environment_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  not_before INTEGER NOT NULL,
  last_error TEXT
);

CREATE TRIGGER session_creation_tombstone BEFORE DELETE ON sessions BEGIN
  INSERT INTO session_tombstones(conversation_id, deleted_at)
  VALUES (OLD.conversation_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(conversation_id) DO NOTHING;
  INSERT INTO session_preparation_cleanup(environment_id, conversation_id, not_before)
  SELECT environment_id, conversation_id, max(lease_until, CAST(unixepoch('subsec') * 1000 AS INTEGER)) + 5000
  FROM session_preparations WHERE conversation_id=OLD.conversation_id
    AND json_extract(creation_json, '$.execution.mode')='managed_worktree'
  ON CONFLICT(environment_id) DO NOTHING;
END;

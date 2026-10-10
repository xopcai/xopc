CREATE TABLE browser_automation_versions (
  automation_id TEXT NOT NULL REFERENCES browser_automations(automation_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (automation_id, revision)
);
INSERT INTO browser_automation_versions SELECT automation_id, revision, definition_json, updated_at_ms FROM browser_automations;

CREATE TABLE browser_automation_verifications (
  automation_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  run_id TEXT NOT NULL REFERENCES browser_automation_runs(run_id) ON DELETE CASCADE,
  verified_at_ms INTEGER NOT NULL,
  PRIMARY KEY (automation_id, revision),
  FOREIGN KEY (automation_id, revision) REFERENCES browser_automation_versions(automation_id, revision) ON DELETE CASCADE
);
ALTER TABLE browser_automation_runs ADD COLUMN client_request_id TEXT;
ALTER TABLE browser_automation_runs ADD COLUMN business_outcome TEXT;
CREATE UNIQUE INDEX idx_browser_run_request ON browser_automation_runs(client_request_id) WHERE client_request_id IS NOT NULL;

CREATE TABLE browser_recordings (
  recording_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  state TEXT NOT NULL,
  ack_seq INTEGER NOT NULL DEFAULT 0,
  final_seq INTEGER,
  automation_id TEXT REFERENCES browser_automations(automation_id) ON DELETE CASCADE,
  error TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE TABLE browser_recording_events (
  recording_id TEXT NOT NULL REFERENCES browser_recordings(recording_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (recording_id, seq)
);

UPDATE automations SET action_json=json_set(action_json, '$.revision', COALESCE((SELECT revision FROM browser_automations WHERE automation_id=json_extract(automations.action_json, '$.automationId')), 1)), enabled=0
WHERE json_extract(action_json, '$.kind')='browser_automation';

UPDATE devices SET scopes_json=json_insert(scopes_json, '$[#]', 'automations.read') WHERE platform='chrome' AND NOT EXISTS(SELECT 1 FROM json_each(scopes_json) WHERE value='automations.read');
UPDATE devices SET scopes_json=json_insert(scopes_json, '$[#]', 'automations.write') WHERE platform='chrome' AND NOT EXISTS(SELECT 1 FROM json_each(scopes_json) WHERE value='automations.write');

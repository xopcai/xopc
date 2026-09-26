ALTER TABLE automation_event_deliveries RENAME TO automation_event_deliveries_v212;
ALTER TABLE automation_events RENAME TO automation_events_v212;

CREATE TABLE automation_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  subject_kind TEXT,
  subject_id TEXT,
  occurred_at_ms INTEGER NOT NULL,
  ingested_at_ms INTEGER NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  root_event_id TEXT NOT NULL,
  chain_depth INTEGER NOT NULL DEFAULT 0 CHECK(chain_depth BETWEEN 0 AND 32),
  dedupe_key TEXT,
  trust TEXT NOT NULL CHECK(trust IN ('system', 'user', 'connector', 'untrusted_webhook')),
  payload_json TEXT NOT NULL,
  projection_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(projection_status IN ('pending', 'projecting', 'retrying', 'projected', 'dead_letter')),
  projected_at_ms INTEGER,
  projection_attempts INTEGER NOT NULL DEFAULT 0,
  projection_next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
  projection_error TEXT,
  projection_owner TEXT,
  projection_lease_until_ms INTEGER
);

INSERT INTO automation_events (
  event_id, event_type, schema_version, source, subject_kind, subject_id,
  occurred_at_ms, ingested_at_ms, correlation_id, causation_id, root_event_id,
  chain_depth, dedupe_key, trust, payload_json, projection_status,
  projected_at_ms, projection_attempts, projection_next_attempt_at_ms, projection_error
)
SELECT event_id, event_type, schema_version, source, subject_kind, subject_id,
  occurred_at_ms, ingested_at_ms, correlation_id, causation_id, root_event_id,
  chain_depth, dedupe_key, trust, payload_json,
  CASE WHEN projected_at_ms IS NULL THEN 'pending' ELSE 'projected' END,
  projected_at_ms, projection_attempts, 0, projection_error
FROM automation_events_v212;

CREATE TABLE automation_event_deliveries (
  event_id TEXT NOT NULL,
  automation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'retrying', 'queued', 'completed', 'failed', 'cancelled', 'skipped', 'dead_letter')),
  run_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  last_error TEXT,
  lease_owner TEXT,
  lease_until_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(event_id, automation_id),
  FOREIGN KEY(event_id) REFERENCES automation_events(event_id) ON DELETE CASCADE
);

INSERT INTO automation_event_deliveries (
  event_id, automation_id, status, run_id, attempts, next_attempt_at_ms,
  last_error, created_at_ms, updated_at_ms
)
SELECT event_id, automation_id, status, run_id, attempts, next_attempt_at_ms,
  last_error, created_at_ms, updated_at_ms
FROM automation_event_deliveries_v212;

DROP TABLE automation_event_deliveries_v212;
DROP TABLE automation_events_v212;

CREATE UNIQUE INDEX idx_automation_events_source_dedupe
  ON automation_events(source, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_automation_events_projection
  ON automation_events(projection_status, projection_next_attempt_at_ms, ingested_at_ms);
CREATE UNIQUE INDEX idx_automation_event_deliveries_run
  ON automation_event_deliveries(run_id)
  WHERE run_id IS NOT NULL;
CREATE INDEX idx_automation_event_deliveries_pending
  ON automation_event_deliveries(status, next_attempt_at_ms, created_at_ms);

ALTER TABLE automation_result_deliveries RENAME TO automation_result_deliveries_v212;

CREATE TABLE automation_results (
  run_id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL UNIQUE,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES automation_runs(run_id) ON DELETE CASCADE
);

INSERT INTO automation_results (run_id, result_id, result_json, created_at_ms)
SELECT DISTINCT d.run_id, 'result:' || d.run_id,
  json_object(
    'schemaVersion', 1,
    'resultId', 'result:' || d.run_id,
    'runId', d.run_id,
    'automationId', r.automation_id,
    'status', r.status,
    'artifacts', json_array(),
    'correlationId', d.run_id,
    'rootEventId', d.run_id,
    'createdAtMs', r.created_at_ms,
    'completedAtMs', COALESCE(r.ended_at_ms, d.created_at_ms)
  ),
  d.created_at_ms
FROM automation_result_deliveries_v212 d
JOIN automation_runs r ON r.run_id = d.run_id;

CREATE TABLE automation_result_deliveries (
  delivery_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  destination_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'delivering', 'retrying', 'delivered', 'dead_letter')),
  config_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  last_error TEXT,
  lease_owner TEXT,
  lease_until_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(run_id, destination_key),
  FOREIGN KEY(run_id) REFERENCES automation_results(run_id) ON DELETE CASCADE
);

INSERT INTO automation_result_deliveries (
  delivery_id, run_id, destination_key, kind, status, config_json, attempts,
  next_attempt_at_ms, last_error, created_at_ms, updated_at_ms
)
SELECT lower(hex(randomblob(16))), run_id, destination_key, kind,
  CASE status
    WHEN 'delivered' THEN 'delivered'
    WHEN 'failed' THEN 'dead_letter'
    WHEN 'pending' THEN 'pending'
    ELSE 'retrying'
  END,
  CASE WHEN kind = 'webhook' THEN json_object(
    'key', destination_key,
    'kind', 'webhook',
    'endpoint', COALESCE(json_extract(config_json, '$.endpoint'), json_extract(config_json, '$.url')),
    'secretId', COALESCE(json_extract(config_json, '$.secretId'), 'completion_webhook')
  ) ELSE json_object('key', destination_key, 'kind', kind) END,
  attempts, next_attempt_at_ms, last_error, created_at_ms, updated_at_ms
FROM automation_result_deliveries_v212
WHERE run_id IN (SELECT run_id FROM automation_results);

DROP TABLE automation_result_deliveries_v212;
CREATE INDEX idx_automation_result_deliveries_pending
  ON automation_result_deliveries(status, next_attempt_at_ms, created_at_ms);

UPDATE automations
SET delivery_json = json_object(
  'notificationPolicy', COALESCE(json_extract(delivery_json, '$.notificationPolicy'), 'attention'),
  'destinations', CASE WHEN json_extract(delivery_json, '$.completionWebhookUrl') IS NULL
    THEN json_array(json_object('key', 'gateway_event', 'kind', 'gateway_event'))
    ELSE json_array(
      json_object('key', 'gateway_event', 'kind', 'gateway_event'),
      json_object(
        'key', 'completion_webhook',
        'kind', 'webhook',
        'endpoint', json_extract(delivery_json, '$.completionWebhookUrl'),
        'secretId', 'completion_webhook'
      )
    )
  END
);

UPDATE automation_run_requests
SET automation_json = json_set(
  automation_json,
  '$.delivery',
  json_object(
    'notificationPolicy', COALESCE(json_extract(automation_json, '$.delivery.notificationPolicy'), 'attention'),
    'destinations', CASE WHEN json_extract(automation_json, '$.delivery.completionWebhookUrl') IS NULL
      THEN json_array(json_object('key', 'gateway_event', 'kind', 'gateway_event'))
      ELSE json_array(
        json_object('key', 'gateway_event', 'kind', 'gateway_event'),
        json_object(
          'key', 'completion_webhook',
          'kind', 'webhook',
          'endpoint', json_extract(automation_json, '$.delivery.completionWebhookUrl'),
          'secretId', 'completion_webhook'
        )
      )
    END
  )
);

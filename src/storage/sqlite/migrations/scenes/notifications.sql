CREATE TABLE notification_browser_keys (
      id INTEGER PRIMARY KEY CHECK(id = 1), public_key TEXT NOT NULL, private_key TEXT NOT NULL
    );
    CREATE TABLE notification_browser_subscriptions (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE, auth_key TEXT NOT NULL, public_key TEXT NOT NULL,
      expires_at INTEGER, language TEXT NOT NULL CHECK(language IN ('en', 'zh')), created_at INTEGER NOT NULL
    );
    CREATE INDEX notification_browser_owner ON notification_browser_subscriptions(owner_id, workspace_id);
    CREATE TABLE notification_presence (
      owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL, client_id TEXT NOT NULL,
      surface TEXT NOT NULL CHECK(surface IN ('web', 'electron', 'mobile')),
      expires_at INTEGER NOT NULL, subject_id TEXT, subject_revision INTEGER,
      source_subject_id TEXT, PRIMARY KEY(owner_id, workspace_id, client_id)
    );
    CREATE TABLE notification_dispatches (
      id TEXT PRIMARY KEY, notification_id TEXT NOT NULL REFERENCES notification_events(event_id),
      owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      channel TEXT NOT NULL CHECK(channel IN ('browser', 'telegram')),
      destination_id TEXT NOT NULL, destination_json TEXT CHECK(destination_json IS NULL OR json_valid(destination_json)),
      subject_id TEXT, subject_revision INTEGER NOT NULL CHECK(subject_revision > 0),
      status TEXT NOT NULL CHECK(status IN ('pending', 'sending', 'accepted', 'failed', 'unknown', 'cancelled')),
      attempt INTEGER NOT NULL CHECK(attempt >= 0), failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count >= 0),
      next_attempt_at INTEGER NOT NULL,
      lease_until INTEGER, provider_message_id TEXT, last_error TEXT,
      UNIQUE(notification_id, channel, destination_id)
    );
    CREATE INDEX notification_dispatch_due ON notification_dispatches(status, next_attempt_at);
    CREATE INDEX notification_dispatch_owner ON notification_dispatches(owner_id, workspace_id);
    CREATE TABLE notification_result_outbox (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL, subject_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'settled', 'failed')),
      attempt INTEGER NOT NULL CHECK(attempt >= 0), next_attempt_at INTEGER NOT NULL,
      lease_until INTEGER, last_error TEXT, decision_reason TEXT,
      created_at INTEGER NOT NULL, settled_at INTEGER, updated_at INTEGER NOT NULL
    );
    CREATE TABLE notification_attention_budget (
      dedupe_key TEXT PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      local_day TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX notification_attention_day ON notification_attention_budget(owner_id, workspace_id, local_day);
    CREATE TABLE notification_digest_queue (
      subject_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      subject_revision INTEGER NOT NULL CHECK(subject_revision > 0), mode TEXT NOT NULL CHECK(mode IN ('daily', 'quiet')),
      due_at INTEGER NOT NULL, consumed_at INTEGER,
      status TEXT NOT NULL CHECK(status IN ('held', 'pending', 'consumed'))
    );
    CREATE TABLE notification_digests (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL, occurrence_key TEXT NOT NULL,
      created_at INTEGER NOT NULL, notification_id TEXT REFERENCES notification_events(event_id),
      UNIQUE(owner_id, workspace_id, occurrence_key)
    );
    CREATE TABLE notification_digest_members (
      digest_id TEXT NOT NULL REFERENCES notification_digests(id), subject_id TEXT NOT NULL,
      subject_revision INTEGER NOT NULL CHECK(subject_revision > 0), PRIMARY KEY(digest_id, subject_id)
    );
    CREATE TABLE notification_dispatch_decisions (
      dedupe_key TEXT PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      disposition TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE notification_browser_probes (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL, subscription_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('accepted', 'opened', 'failed', 'unknown')),
      created_at INTEGER NOT NULL, opened_at INTEGER, error TEXT
    );

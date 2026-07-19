CREATE TABLE user_trust_policies_next (
  principal_id TEXT PRIMARY KEY,
  default_action_level TEXT NOT NULL DEFAULT 'confirm'
    CHECK (default_action_level IN ('observe', 'suggest', 'confirm', 'auto')),
  updated_at TEXT NOT NULL
);

INSERT INTO user_trust_policies_next (principal_id, default_action_level, updated_at)
SELECT principal_id, default_action_level, updated_at
FROM user_trust_policies;

DROP TABLE user_trust_policies;

ALTER TABLE user_trust_policies_next RENAME TO user_trust_policies;

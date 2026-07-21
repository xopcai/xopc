CREATE TABLE IF NOT EXISTS extension_ui_grants (
  extension_id TEXT NOT NULL,
  app_id TEXT,
  manifest_digest TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (extension_id, manifest_digest),
  FOREIGN KEY (app_id) REFERENCES local_apps(app_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_extension_ui_grants_app_granted
  ON extension_ui_grants(app_id, granted_at DESC);

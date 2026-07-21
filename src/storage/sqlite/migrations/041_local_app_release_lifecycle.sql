ALTER TABLE local_apps ADD COLUMN installation_state TEXT NOT NULL DEFAULT 'not_installed'
  CHECK (installation_state IN ('not_installed', 'installed'));
ALTER TABLE local_apps ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1));
ALTER TABLE local_apps ADD COLUMN active_release_id TEXT;

UPDATE local_apps
SET installation_state = CASE WHEN active_version IS NULL THEN 'not_installed' ELSE 'installed' END,
    enabled = CASE WHEN active_version IS NULL THEN 0 ELSE 1 END;

ALTER TABLE local_app_releases ADD COLUMN artifact_path TEXT;
ALTER TABLE local_app_releases ADD COLUMN manifest_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE local_app_releases ADD COLUMN health_status TEXT NOT NULL DEFAULT 'healthy'
  CHECK (health_status IN ('healthy', 'failed'));
ALTER TABLE local_app_releases ADD COLUMN activated_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_local_app_releases_created
  ON local_app_releases(app_id, created_at DESC);

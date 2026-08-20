ALTER TABLE dreaming_runs ADD COLUMN algorithm_version TEXT NOT NULL DEFAULT 'structured-v1';
ALTER TABLE dreaming_runs ADD COLUMN config_snapshot_json TEXT NOT NULL DEFAULT '{}';

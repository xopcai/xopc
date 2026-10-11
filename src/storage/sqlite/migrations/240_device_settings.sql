CREATE TABLE endpoint_device_settings (
  principal_id TEXT PRIMARY KEY REFERENCES endpoint_principals(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL CHECK(length(nickname) BETWEEN 1 AND 80),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
);

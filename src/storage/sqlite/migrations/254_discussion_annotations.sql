CREATE TABLE discussion_annotations (
  discussion_id TEXT NOT NULL REFERENCES discussion_captures(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('highlight','question','note')),
  text TEXT NOT NULL,
  anchor_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(discussion_id,id)
);
CREATE TABLE discussion_media_timeline (
  discussion_id TEXT PRIMARY KEY REFERENCES discussion_captures(id) ON DELETE CASCADE,
  audio_sha256 TEXT NOT NULL,
  timeline_json TEXT NOT NULL
);

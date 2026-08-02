CREATE TABLE interaction_states (
  session_key TEXT PRIMARY KEY REFERENCES sessions(session_key) ON DELETE CASCADE,
  support_need TEXT NOT NULL CHECK (support_need IN ('listen', 'clarify', 'advise', 'act', 'unknown')),
  emotion_hypothesis TEXT,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source TEXT NOT NULL CHECK (source IN ('explicit', 'inferred')),
  repair_status TEXT NOT NULL CHECK (repair_status IN ('none', 'needed', 'repaired')),
  repair_reason TEXT,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

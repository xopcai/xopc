ALTER TABLE session_config ADD COLUMN fixed_model INTEGER NOT NULL DEFAULT 0 CHECK (fixed_model IN (0, 1));

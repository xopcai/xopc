-- Migration: Add memory flush tracking columns to sessions table
ALTER TABLE sessions ADD COLUMN last_flushed_at TEXT;
ALTER TABLE sessions ADD COLUMN flush_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE execution_environments
  ADD COLUMN ownership TEXT NOT NULL DEFAULT 'registered'
  CHECK (ownership IN ('registered', 'xopc_created'));

UPDATE execution_environments
SET ownership = 'xopc_created'
WHERE kind = 'managed_worktree';

-- Project stack, repository workflow, and current focus now live in work discovery
-- summaries/threads/focuses instead of the user's durable profile.
UPDATE user_understandings
SET status = 'archived',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE status IN ('candidate', 'active', 'needs_review', 'stale')
  AND (
    canonical_key LIKE 'work-discovery:technology:%'
    OR canonical_key LIKE 'work-discovery:workflow:%'
    OR canonical_key LIKE 'work-discovery:focus:%'
  );

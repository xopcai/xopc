UPDATE sessions
SET project_id = (
  SELECT a.project_id
  FROM automation_runs r
  JOIN automations a ON a.automation_id = r.automation_id
  WHERE r.session_key = sessions.session_key
    AND a.project_id IS NOT NULL
  ORDER BY r.created_at_ms DESC
  LIMIT 1
)
WHERE project_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM automation_runs r
    JOIN automations a ON a.automation_id = r.automation_id
    WHERE r.session_key = sessions.session_key
      AND a.project_id IS NOT NULL
  );

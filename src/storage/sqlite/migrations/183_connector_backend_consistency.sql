-- Repair only accounts whose authorizations agree on one known backend.
-- Identity collisions are reconciled transactionally by the next provider sync.
WITH candidates AS (
  SELECT c.account_id, MIN(json_extract(c.metadata_json, '$.backendId')) AS backend_id
  FROM connector_connections c
  GROUP BY c.account_id
  HAVING COUNT(DISTINCT json_extract(c.metadata_json, '$.backendId')) = 1
    AND COUNT(json_extract(c.metadata_json, '$.backendId')) = COUNT(*)
)
UPDATE connector_accounts AS account
SET backend_id = (SELECT backend_id FROM candidates WHERE account_id = account.id)
WHERE account.backend_id IS NULL
  AND EXISTS (SELECT 1 FROM candidates JOIN connector_backends backend ON backend.id = candidates.backend_id WHERE candidates.account_id = account.id)
  AND NOT EXISTS (
    SELECT 1 FROM connector_accounts other JOIN candidates ON candidates.account_id = account.id
    WHERE other.id <> account.id
      AND COALESCE(other.backend_id, (SELECT backend_id FROM candidates WHERE account_id = other.id)) = candidates.backend_id
      AND other.principal_id = account.principal_id AND other.connector_id = account.connector_id
      AND other.identity_key = account.identity_key
  );

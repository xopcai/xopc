UPDATE automations
SET reliability_json = json_remove(
  json_set(
    reliability_json,
    '$.executionTimeoutSeconds',
    COALESCE(
      json_extract(reliability_json, '$.executionTimeoutSeconds'),
      json_extract(reliability_json, '$.timeoutSeconds')
    )
  ),
  '$.timeoutSeconds'
)
WHERE reliability_json IS NOT NULL
  AND json_type(reliability_json, '$.timeoutSeconds') IS NOT NULL;

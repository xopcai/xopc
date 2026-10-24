-- Remove obsolete response controls before strict Agent profile validation.
UPDATE agents
SET profile_json = json_remove(profile_json, '$.responsePreferences'), revision = revision + 1
WHERE profile_json IS NOT NULL AND json_type(profile_json, '$.responsePreferences') IS NOT NULL;

-- Rebuild Personal instructions from the product defaults on the next load.
UPDATE agents
SET profile_json = json_remove(profile_json, '$.instructions'), revision = revision + 1
WHERE id IN (SELECT agent_id FROM sessions WHERE json_extract(custom_data_json, '$.personalAgent') = 1)
  AND profile_json IS NOT NULL;

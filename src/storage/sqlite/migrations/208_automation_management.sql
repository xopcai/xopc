ALTER TABLE automations ADD COLUMN management_json TEXT
  CHECK(management_json IS NULL OR json_valid(management_json));

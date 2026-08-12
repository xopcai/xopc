UPDATE proactive_scenarios
SET condition_json = '{"op":"neq","field":"payload.after.status","value":"blocked"}',
    version = version + 1,
    updated_at = datetime('now')
WHERE scenario_key = 'project_delivery_risk';

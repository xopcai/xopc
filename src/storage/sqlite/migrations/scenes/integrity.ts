import type { DatabaseSync } from 'node:sqlite';

/** Cross-table identity checks that foreign keys alone cannot express. Never reads source runtime tables. */
export function assertSceneHistoryIntegrity(db: DatabaseSync): void {
  const checks: Array<[string, string]> = [
    ['active_instruction', `SELECT 1 FROM scene_activation_details a LEFT JOIN scene_instruction_revisions i ON i.id = a.active_instruction_id
      WHERE a.active_instruction_id IS NOT NULL AND (i.id IS NULL OR i.activation_id <> a.activation_id OR i.status <> 'published') LIMIT 1`],
    ['intent_subscription', `SELECT 1 FROM scene_intent_details d JOIN scene_trigger_intents t ON t.id = d.intent_id
      LEFT JOIN scene_activation_details a ON a.activation_id = t.activation_id
      WHERE a.activation_id IS NULL OR a.source_subscription_id <> d.source_subscription_id OR a.source_definition_key <> d.source_template_key LIMIT 1`],
    ['run_subscription', `SELECT 1 FROM scene_runs r LEFT JOIN scene_run_details d ON d.run_id = r.id
      LEFT JOIN scene_check_details c ON c.run_id = r.id
      LEFT JOIN scene_activation_details a ON a.activation_id = r.activation_id
      WHERE r.origin = 'import' AND ((d.run_id IS NULL AND c.run_id IS NULL) OR (d.run_id IS NOT NULL AND c.run_id IS NOT NULL)
        OR (d.run_id IS NOT NULL AND (a.activation_id IS NULL OR a.source_subscription_id <> d.source_subscription_id
          OR a.source_definition_key <> d.source_template_key))) LIMIT 1`],
    ['check_identity', `SELECT 1 FROM scene_check_details c JOIN scene_runs r ON r.id = c.run_id
      JOIN scene_activations a ON a.id = r.activation_id
      WHERE r.origin <> 'import' OR c.source_check_id <> r.id OR c.source_workspace_id <> a.workspace_id LIMIT 1`],
    ['mail_subscription', `SELECT 1 FROM scene_mail_history h JOIN scene_work_items w ON w.id = h.work_item_id
      JOIN scene_activations a ON a.id = w.activation_id LEFT JOIN scene_activation_details d ON d.source_subscription_id = h.source_subscription_id
      LEFT JOIN scene_activations parent ON parent.id = d.activation_id
      WHERE parent.id IS NULL OR a.owner_id <> parent.owner_id OR a.workspace_id <> parent.workspace_id LIMIT 1`],
    ['run_instruction', `SELECT 1 FROM scene_run_details d JOIN scene_runs r ON r.id = d.run_id
      LEFT JOIN scene_instruction_revisions i ON i.id = d.instruction_revision_id
      WHERE d.instruction_revision_id IS NOT NULL AND (i.id IS NULL OR i.activation_id <> r.activation_id) LIMIT 1`],
    ['instruction_feedback', `SELECT 1 FROM scene_instruction_feedback f
      JOIN scene_presentations p ON p.id = f.presentation_id JOIN scene_outcomes o ON o.id = p.outcome_id
      JOIN scene_runs r ON r.id = o.run_id LEFT JOIN scene_instruction_revisions i ON i.id = f.instruction_revision_id
      WHERE i.id IS NULL OR i.activation_id <> r.activation_id LIMIT 1`],
    ['snapshot_intent', `SELECT 1 FROM scene_run_details d JOIN scene_runs r ON r.id = d.run_id
      JOIN scene_evidence_snapshots s ON s.id = d.evidence_snapshot_id WHERE s.intent_id <> r.intent_id LIMIT 1`],
    ['intent_event_scope', `SELECT 1 FROM scene_intent_events m JOIN scene_trigger_intents t ON t.id = m.intent_id
      JOIN scene_activations a ON a.id = t.activation_id JOIN scene_events e ON e.id = m.event_id
      WHERE a.owner_id <> e.owner_id OR a.workspace_id <> e.workspace_id LIMIT 1`],
    ['definition_version', `SELECT 1 FROM scene_intent_details d LEFT JOIN scene_definition_history h
      ON h.definition_key = d.source_template_key AND h.version = d.source_template_version AND h.record_kind = 'version'
      WHERE h.definition_key IS NULL LIMIT 1`],
    ['run_intent_identity', `SELECT 1 FROM scene_runs r JOIN scene_trigger_intents t ON t.id = r.intent_id
      WHERE r.activation_id <> t.activation_id OR r.activation_revision <> t.activation_revision LIMIT 1`],
    ['run_definition_version', `SELECT 1 FROM scene_run_details d JOIN scene_runs r ON r.id = d.run_id
      JOIN scene_intent_details t ON t.intent_id = r.intent_id
      WHERE d.source_template_version <> t.source_template_version LIMIT 1`],
  ];
  for (const [name, sql] of checks) if (db.prepare(sql).get()) throw new Error(`Scene history integrity check failed: ${name}`);
}

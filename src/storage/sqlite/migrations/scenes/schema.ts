import type { DatabaseSync } from 'node:sqlite';

import { readSqliteAsset } from '../../sql-assets.js';

export const NOTIFICATION_LEDGER_TABLES = [
  'notification_browser_keys', 'notification_browser_subscriptions', 'notification_dispatches',
  'notification_result_outbox', 'notification_attention_budget', 'notification_digest_queue',
  'notification_digests', 'notification_digest_members', 'notification_dispatch_decisions', 'notification_browser_probes',
  'notification_presence',
] as const;

/** Storage initialization shared by the cutover and isolated database tests. */
export function installSceneSchema(db: DatabaseSync): void {
  db.exec(readSqliteAsset('migrations/scenes/scenes.sql'));
}

export function installNotificationLedgerSchema(db: DatabaseSync): void {
  db.exec(readSqliteAsset('migrations/scenes/notifications.sql'));
}

export function installSceneCutoverSchema(db: DatabaseSync): void {
  installSceneSchema(db);
  installNotificationLedgerSchema(db);
}

export const SCENE_CUTOVER_TABLES = [
  'scene_template_versions', 'scene_activations', 'scene_notes', 'scene_activation_requests',
  'scene_work_items', 'scene_events', 'scene_trigger_intents', 'scene_schedule_cursors',
  'scene_runs', 'scene_model_reservations', 'scene_context_snapshots', 'scene_outcomes',
  'scene_presentations', 'scene_feedback', 'scene_feedback_history',
  'scene_event_details', 'scene_intent_events', 'scene_intent_details', 'scene_evidence_snapshots', 'scene_run_details',
  'scene_decisions', 'scene_instruction_feedback', 'scene_presentation_requests', 'scene_presentation_reviews', 'scene_presentation_changes',
  'scene_instruction_revisions', 'scene_activation_details',
  'scene_preferences',
  'scene_check_details',
  'scene_definition_history',
  'scene_mail_history',
  'scene_checklist_imports', 'scene_cutover_counts',
] as const;

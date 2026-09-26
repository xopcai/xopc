import type { DatabaseSync } from 'node:sqlite';

import { readSqliteAsset } from './sql-assets.js';

export const NOTIFICATION_LEDGER_TABLES = [
  'notification_browser_keys', 'notification_browser_subscriptions', 'notification_dispatches',
  'notification_result_outbox', 'notification_attention_budget', 'notification_digest_queue',
  'notification_digests', 'notification_digest_members', 'notification_dispatch_decisions', 'notification_browser_probes',
  'notification_presence',
] as const;

export const SCENE_TABLES = [
  'scene_source_health', 'scene_activation_requests', 'scene_activations', 'scene_context_snapshots',
  'scene_events', 'scene_feedback', 'scene_feedback_history',
  'scene_intent_events', 'scene_model_reservations', 'scene_notes',
  'scene_outcomes', 'scene_preferences', 'scene_presentations',
  'scene_runs', 'scene_schedule_cursors', 'scene_template_versions',
  'scene_trigger_intents', 'scene_work_items', 'scene_mail_sources', 'scene_connector_usage',
] as const;

/** Installs fresh tables; the normal versioned upgrade owns existing databases. */
export function installSceneSchema(db: DatabaseSync): void {
  db.exec(readSqliteAsset('schemas/scenes.sql'));
}

export function installNotificationLedgerSchema(db: DatabaseSync): void {
  db.exec(readSqliteAsset('schemas/notifications.sql'));
}

export function installSceneStorage(db: DatabaseSync): void {
  installSceneSchema(db);
  installNotificationLedgerSchema(db);
}

export function assertSceneStorageReady(db: DatabaseSync): void {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
  if ([...SCENE_TABLES, ...NOTIFICATION_LEDGER_TABLES].some(name => !tables.has(name))) {
    throw new Error('Scene storage is not initialized');
  }
}

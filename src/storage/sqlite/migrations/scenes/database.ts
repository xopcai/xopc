import type { DatabaseSync } from 'node:sqlite';

import { installSceneCutoverSchema } from './schema.js';
import type { SceneCutoverBindings } from './bindings.js';
import { convertSceneActivationHistory } from './activations.js';
import { convertSceneChecks } from './checks.js';
import { convertSceneDefinitions } from './definitions.js';
import { convertSceneExecutionHistory } from './execution.js';
import { convertSceneFeedback } from './feedback.js';
import { convertSceneHeartbeat, type SceneChecklistImport } from './heartbeat.js';
import { assertSceneHistoryIntegrity } from './integrity.js';
import { convertSceneMailFollowUps } from './mail.js';
import { convertSceneNotifications } from './notifications.js';
import { convertSceneNotificationTargets } from './notificationTargets.js';
import { convertSceneOutcomeHistory } from './outcomes.js';
import { convertScenePreferences } from './preferences.js';
import { inspectSceneCutover } from './preflight.js';
import { prepareSceneHistoryActivations } from './preparation.js';

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Remove only reviewed source tables, children first, with FK enforcement left enabled. */
function removeSourceTables(db: DatabaseSync, source: string[]): void {
  const remaining = new Set(source);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name));
  const dependencies = new Map(tables.map((table) => [table,
    new Set(db.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all().map((row) => String(row.table)))]));
  const sourceReference = new RegExp(`\\b(?:${source.join('|')})\\b`, 'i');
  const externalSchema = db.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type IN ('view', 'trigger')").all();
  if (externalSchema.some((row) => !remaining.has(String(row.tbl_name)) && sourceReference.test(String(row.sql)))) {
    throw new Error('Unconverted view or trigger references scene source history');
  }
  if (tables.some((table) => !remaining.has(table) && [...dependencies.get(table)!].some((parent) => remaining.has(parent)))) {
    throw new Error('Unconverted table references scene source history');
  }
  while (remaining.size) {
    const leaves = [...remaining].filter((table) => ![...remaining].some((child) => child !== table && dependencies.get(child)!.has(table)));
    if (!leaves.length) throw new Error('Cyclic source history dependencies require review');
    for (const table of leaves) { db.exec(`DROP TABLE ${quote(table)}`); remaining.delete(table); }
  }
}

/** Complete synchronous import. The release journal supplies the outer exclusive transaction and backup. */
export function convertSceneDatabase(db: DatabaseSync, input: {
  config: Readonly<Record<string, unknown>>; owners: SceneCutoverBindings;
  mailAccounts: Array<{ followUpId: string; accountId: string }>;
  heartbeatWorkspaceId?: string; checklists: SceneChecklistImport[];
}): void {
  const source = inspectSceneCutover(db);
  if (source.blockers.length) throw new Error(`Scene conversion requires reconciliation: ${source.blockers.join(', ')}`);
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Source history contains broken foreign keys');
  db.exec('SAVEPOINT scene_database_conversion');
  try {
    installSceneCutoverSchema(db);
    const definitions = convertSceneDefinitions(db);
    const prepared = prepareSceneHistoryActivations(db, { owners: input.owners,
      checklistWorkspaces: [...input.checklists.map((row) => row.workspaceId), ...(input.heartbeatWorkspaceId ? [input.heartbeatWorkspaceId] : [])] });
    const activations = convertSceneActivationHistory(db, { owners: input.owners, activations: prepared.activations });
    const activationMap = new Map(prepared.activations.map((row) => [row.subscriptionId, row.activationId]));
    const batchRows = db.prepare('SELECT batch_id, subscription_id FROM proactive_signal_batches LIMIT 100001').all();
    const execution = convertSceneExecutionHistory(db, { owners: input.owners, batches: batchRows.map((row) => ({
      batchId: row.batch_id, activationId: activationMap.get(String(row.subscription_id)),
    })) });
    const outcomes = convertSceneOutcomeHistory(db, { owners: input.owners });
    const feedback = convertSceneFeedback(db, { owners: input.owners, presentations: outcomes.presentations });
    const mail = convertSceneMailFollowUps(db, { owners: input.owners, accounts: input.mailAccounts });
    const checks = convertSceneChecks(db, { owners: input.owners, activations: prepared.checks });
    convertSceneHeartbeat(db, { config: input.config, owners: input.owners, configWorkspaceId: input.heartbeatWorkspaceId,
      checklists: input.checklists, activations: prepared.checks });
    const notifications = convertSceneNotifications(db, { owners: input.owners, presentations: outcomes.presentations });
    const preferences = convertScenePreferences(db, { owners: input.owners, presentations: outcomes.presentations });
    const sourceNotificationCount = Number(db.prepare("SELECT count(*) AS n FROM notification_events WHERE event_type = 'proactive.insight'").get()?.n);
    if (convertSceneNotificationTargets(db) !== sourceNotificationCount) throw new Error('Notification target conversion count mismatch');
    const counts: Record<string, number> = {
      proactive_scenarios: definitions.definitions, proactive_scenario_versions: definitions.versions,
      proactive_scenario_subscriptions: activations.subscriptions, proactive_prompt_revisions: activations.revisions,
      proactive_subscription_settings: activations.settings, proactive_schedule_state: activations.schedules,
      proactive_events: execution.events, proactive_signal_batches: execution.batches, proactive_batch_events: execution.memberships,
      proactive_context_snapshots: execution.snapshots, proactive_runs: execution.runs,
      proactive_insights: outcomes.counts.outcomes, proactive_inbox_items: outcomes.counts.presentations,
      proactive_decisions: outcomes.counts.decisions, proactive_instruction_feedback: outcomes.counts.instructions,
      proactive_card_actions: outcomes.counts.requests, proactive_card_review_state: outcomes.counts.reviews,
      proactive_card_changes: outcomes.counts.changes, proactive_feedback: feedback,
      proactive_follow_ups: mail.length, heartbeat_checks: checks.checks,
      proactive_preferences: preferences.preferences, proactive_presence: preferences.presence, ...notifications,
    };
    if (source.tables.length !== Object.keys(counts).length) throw new Error('Scene source table inventory differs from the reviewed schema');
    for (const table of source.tables) {
      if (counts[table.name] !== table.rows) throw new Error(`Scene conversion row count mismatch: ${table.name}`);
      db.prepare('INSERT INTO scene_cutover_counts VALUES (?, ?, ?)').run(table.name, table.rows, counts[table.name]);
    }
    assertSceneHistoryIntegrity(db);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Converted scene history contains broken foreign keys');
    removeSourceTables(db, source.tables.map((row) => row.name));
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Source removal broke foreign keys');
    db.exec('RELEASE scene_database_conversion');
  } catch (error) {
    db.exec('ROLLBACK TO scene_database_conversion'); db.exec('RELEASE scene_database_conversion'); throw error;
  }
}

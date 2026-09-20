import type { DatabaseSync } from 'node:sqlite';

import { installSceneStorage, NOTIFICATION_LEDGER_TABLES } from '../scenes-schema.js';

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Discard obsolete payloads before historical migrations try to interpret them. */
export function discardExperimentalSceneData(db: DatabaseSync): void {
  // Disable old audit/immutability triggers while clearing their unused rows.
  const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name GLOB 'proactive_*'").all();
  for (const trigger of triggers) db.exec(`DROP TRIGGER ${quote(String(trigger.name))}`);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND (name GLOB 'proactive_*' OR name = 'heartbeat_checks') AND name NOT IN ('proactive_scenarios', 'proactive_scenario_versions')").all();
  // Historical migrations still read the catalog until the final reset runs.
  for (const table of tables) db.exec(`DELETE FROM ${quote(String(table.name))}`);
  for (const trigger of triggers) db.exec(String(trigger.sql));
  const discarded = "SELECT event_id FROM notification_events WHERE event_type IN ('proactive.insight', 'scene.result', 'scene.digest')";
  for (const table of ['notification_deliveries', 'notification_acknowledgements']) {
    db.exec(`DELETE FROM ${table} WHERE event_id IN (${discarded})`);
  }
  db.exec(`DELETE FROM notification_events WHERE event_id IN (${discarded})`);
}

/** v188 installs current storage; the migration runner owns the transaction and FK checks. */
export function resetExperimentalScenes(db: DatabaseSync): void {
  const ledger = new Set<string>(NOTIFICATION_LEDGER_TABLES);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  for (const table of tables) {
    const name = String(table.name);
    if (name.startsWith('scene_') || ledger.has(name)) db.exec(`DROP TABLE ${quote(name)}`);
  }
  discardExperimentalSceneData(db);
  for (const table of tables) {
    const name = String(table.name);
    if (name.startsWith('proactive_') || name === 'heartbeat_checks' || name === 'project_monitoring_policies') {
      db.exec(`DROP TABLE ${quote(name)}`);
    }
  }
  db.exec(`DROP INDEX IF EXISTS idx_connector_sync_policies_proactive;
    ALTER TABLE connector_sync_policies DROP COLUMN proactive_enabled;
    ALTER TABLE connector_sync_policies DROP COLUMN allowed_scenario_keys_json;`);
  installSceneStorage(db);
}

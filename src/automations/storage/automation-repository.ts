import type { Automation } from '../domain/types.js';
import { AutomationSchema } from '../domain/validation.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';

type AutomationRow = {
  automation_id: string;
  name: string;
  description: string | null;
  enabled: number;
  trigger_json: string;
  action_json: string;
  after_run_json: string | null;
  reliability_json: string | null;
  state_json: string;
  created_at_ms: number;
  updated_at_ms: number;
};

function parseJson(value: string | null): unknown {
  if (!value) return undefined;
  return JSON.parse(value);
}

function bindJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function rowToAutomation(row: AutomationRow): Automation {
  return AutomationSchema.parse({
    id: row.automation_id,
    name: row.name,
    description: row.description ?? undefined,
    enabled: row.enabled !== 0,
    trigger: parseJson(row.trigger_json),
    action: parseJson(row.action_json),
    afterRun: parseJson(row.after_run_json),
    reliability: parseJson(row.reliability_json),
    state: parseJson(row.state_json) ?? {},
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  }) as Automation;
}

function upsertAutomation(db: ReturnType<typeof getSqliteDatabase>, automation: Automation): void {
  db.prepare(
    `INSERT OR REPLACE INTO automations (
      automation_id, name, description, enabled, trigger_json, action_json,
      after_run_json, reliability_json, state_json, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    automation.id,
    automation.name,
    automation.description ?? null,
    automation.enabled ? 1 : 0,
    JSON.stringify(automation.trigger),
    JSON.stringify(automation.action),
    bindJson(automation.afterRun),
    bindJson(automation.reliability),
    JSON.stringify(automation.state ?? {}),
    automation.createdAtMs,
    automation.updatedAtMs,
  );
}

const AUTOMATION_SELECT = `
  SELECT automation_id, name, description, enabled, trigger_json, action_json,
         after_run_json, reliability_json, state_json, created_at_ms, updated_at_ms
  FROM automations
`;

export function listAutomations(): Automation[] {
  const rows = getSqliteDatabase()
    .prepare(`${AUTOMATION_SELECT} ORDER BY created_at_ms DESC`)
    .all() as AutomationRow[];
  return rows.map(rowToAutomation);
}

export function getAutomation(automationId: string): Automation | null {
  const row = getSqliteDatabase()
    .prepare(`${AUTOMATION_SELECT} WHERE automation_id = ?`)
    .get(automationId) as AutomationRow | undefined;
  return row ? rowToAutomation(row) : null;
}

export function saveAutomation(automation: Automation): void {
  runSqliteWriteTransaction((db) => upsertAutomation(db, automation));
}

export function saveAutomations(automations: Automation[]): void {
  runSqliteWriteTransaction((db) => {
    for (const automation of automations) {
      upsertAutomation(db, automation);
    }
  });
}

export function deleteAutomation(automationId: string): boolean {
  return runSqliteWriteTransaction((db) => {
    const result = db.prepare(`DELETE FROM automations WHERE automation_id = ?`).run(automationId);
    return result.changes > 0;
  });
}


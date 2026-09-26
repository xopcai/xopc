import type { Automation } from '../domain/types.js';
import { AutomationSchema } from '../domain/validation.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';

type AutomationRow = {
  automation_id: string;
  name: string;
  description: string | null;
  project_id: string | null;
  enabled: number;
  trigger_json: string;
  action_json: string;
  safety_json: string | null;
  conversation_mode: Automation['conversationMode'];
  delivery_json: string;
  reliability_json: string | null;
  management_json: string | null;
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
    projectId: row.project_id ?? undefined,
    enabled: row.enabled !== 0,
    trigger: parseJson(row.trigger_json),
    action: parseJson(row.action_json),
    safety: parseJson(row.safety_json) ?? { mode: 'auto_apply' },
    conversationMode: row.conversation_mode,
    delivery: parseJson(row.delivery_json),
    reliability: parseJson(row.reliability_json),
    management: parseJson(row.management_json),
    state: parseJson(row.state_json) ?? {},
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  }) as Automation;
}

function upsertAutomation(db: ReturnType<typeof getSqliteDatabase>, automation: Automation): void {
  db.prepare(
    `INSERT OR REPLACE INTO automations (
      automation_id, name, description, project_id, enabled, trigger_json, action_json,
      safety_json, conversation_mode, delivery_json,
      reliability_json, management_json, state_json, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    automation.id,
    automation.name,
    automation.description ?? null,
    automation.projectId ?? null,
    automation.enabled ? 1 : 0,
    JSON.stringify(automation.trigger),
    JSON.stringify(automation.action),
    bindJson(automation.safety ?? { mode: 'auto_apply' }),
    automation.conversationMode,
    bindJson(automation.delivery),
    bindJson(automation.reliability),
    bindJson(automation.management),
    JSON.stringify(automation.state ?? {}),
    automation.createdAtMs,
    automation.updatedAtMs,
  );
}

const AUTOMATION_SELECT = `
  SELECT automation_id, name, description, project_id, enabled, trigger_json, action_json,
         safety_json, conversation_mode, delivery_json,
         reliability_json, management_json, state_json, created_at_ms, updated_at_ms
  FROM automations
`;

export function listAutomations(options?: { projectId?: string }): Automation[] {
  const db = getSqliteDatabase();
  const rows = options?.projectId
    ? db.prepare(`${AUTOMATION_SELECT} WHERE project_id = ? ORDER BY created_at_ms DESC`).all(options.projectId)
    : db.prepare(`${AUTOMATION_SELECT} ORDER BY created_at_ms DESC`).all();
  return (rows as AutomationRow[]).map(rowToAutomation);
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
    db.prepare(`INSERT INTO automation_deleted_revisions (automation_id, revision)
      SELECT automation_id, updated_at_ms FROM automations WHERE automation_id = ?
      ON CONFLICT(automation_id) DO UPDATE SET revision = MAX(revision, excluded.revision)`).run(automationId);
    const result = db.prepare(`DELETE FROM automations WHERE automation_id = ?`).run(automationId);
    return result.changes > 0;
  });
}

/** Keep revisions distinct when a caller recreates a previously deleted identity. */
export function getDeletedAutomationRevision(automationId: string): number | undefined {
  const row = getSqliteDatabase().prepare('SELECT revision FROM automation_deleted_revisions WHERE automation_id = ?').get(automationId);
  return row ? Number(row.revision) : undefined;
}

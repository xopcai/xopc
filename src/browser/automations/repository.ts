import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/index.js';
import type { BrowserAutomation, BrowserAutomationRun, BrowserAutomationRunEvent } from './types.js';

type AutomationRow = { verified: number; automation_id: string; revision: number; status: BrowserAutomation['status']; definition_json: string; created_at_ms: number; updated_at_ms: number };
type RunRow = { client_request_id: string | null; business_outcome: BrowserAutomationRun['businessOutcome'] | null; run_id: string; automation_id: string; automation_revision: number; definition_json: string; status: BrowserAutomationRun['status']; inputs_json: string; result_json: string | null; error: string | null; created_at_ms: number; started_at_ms: number | null; ended_at_ms: number | null; duration_ms: number | null };
type EventRow = { event_id: string; run_id: string; seq: number; type: string; data_json: string | null; created_at_ms: number };

const AUTOMATION_SELECT = 'SELECT a.*, EXISTS(SELECT 1 FROM browser_automation_verifications v WHERE v.automation_id=a.automation_id AND v.revision=a.revision) AS verified FROM browser_automations a';
const RUN_SELECT = 'SELECT client_request_id, business_outcome, run_id, automation_id, automation_revision, definition_json, status, inputs_json, result_json, error, created_at_ms, started_at_ms, ended_at_ms, duration_ms FROM browser_automation_runs';

const parseAutomation = (row: AutomationRow): BrowserAutomation => ({ verified: !!row.verified, id: row.automation_id, revision: row.revision, status: row.status, definition: JSON.parse(row.definition_json), createdAtMs: row.created_at_ms, updatedAtMs: row.updated_at_ms });
const parseRun = (row: RunRow): BrowserAutomationRun => ({ clientRequestId: row.client_request_id ?? undefined, businessOutcome: row.business_outcome ?? undefined, id: row.run_id, automationId: row.automation_id, automationRevision: row.automation_revision, definition: JSON.parse(row.definition_json), status: row.status, inputs: JSON.parse(row.inputs_json), result: row.result_json ? JSON.parse(row.result_json) : undefined, error: row.error ?? undefined, createdAtMs: row.created_at_ms, startedAtMs: row.started_at_ms ?? undefined, endedAtMs: row.ended_at_ms ?? undefined, durationMs: row.duration_ms ?? undefined });

export const listBrowserAutomations = (): BrowserAutomation[] => (getSqliteDatabase().prepare(`${AUTOMATION_SELECT} ORDER BY updated_at_ms DESC`).all() as AutomationRow[]).map(parseAutomation);
export const getBrowserAutomation = (id: string): BrowserAutomation | null => { const row = getSqliteDatabase().prepare(`${AUTOMATION_SELECT} WHERE a.automation_id = ?`).get(id) as AutomationRow | undefined; return row ? parseAutomation(row) : null; };
export function saveBrowserAutomation(value: BrowserAutomation): void {
  runSqliteWriteTransaction((db) => {
    db.prepare('INSERT INTO browser_automations (automation_id, revision, status, definition_json, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(automation_id) DO UPDATE SET revision=excluded.revision, status=excluded.status, definition_json=excluded.definition_json, updated_at_ms=excluded.updated_at_ms').run(value.id, value.revision, value.status, JSON.stringify(value.definition), value.createdAtMs, value.updatedAtMs);
    db.prepare('INSERT OR IGNORE INTO browser_automation_versions (automation_id, revision, definition_json, created_at_ms) VALUES (?, ?, ?, ?)').run(value.id, value.revision, JSON.stringify(value.definition), value.updatedAtMs);
  });
}
export function getBrowserAutomationVersion(id: string, revision: number): BrowserAutomation | null {
  const row = getSqliteDatabase().prepare('SELECT v.*, a.status, a.created_at_ms, v.created_at_ms AS updated_at_ms, EXISTS(SELECT 1 FROM browser_automation_verifications p WHERE p.automation_id=v.automation_id AND p.revision=v.revision) AS verified FROM browser_automation_versions v JOIN browser_automations a USING(automation_id) WHERE v.automation_id=? AND v.revision=?').get(id, revision) as AutomationRow | undefined;
  return row ? parseAutomation(row) : null;
}
export function listBrowserAutomationVersions(id: string): BrowserAutomation[] {
  const rows = getSqliteDatabase().prepare('SELECT revision FROM browser_automation_versions WHERE automation_id=? ORDER BY revision DESC').all(id) as { revision: number }[];
  return rows.map((row) => getBrowserAutomationVersion(id, row.revision)!);
}
export function verifyBrowserAutomationRun(run: BrowserAutomationRun): void {
  if (run.status !== 'succeeded' || run.businessOutcome !== 'verified') return;
  runSqliteWriteTransaction((db) => db.prepare('INSERT INTO browser_automation_verifications (automation_id, revision, run_id, verified_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT(automation_id, revision) DO UPDATE SET run_id=excluded.run_id, verified_at_ms=excluded.verified_at_ms').run(run.automationId, run.automationRevision, run.id, run.endedAtMs));
}
export function findBrowserAutomationRunByRequest(requestId: string): BrowserAutomationRun | null {
  const row = getSqliteDatabase().prepare(`${RUN_SELECT} WHERE client_request_id=?`).get(requestId) as RunRow | undefined;
  return row ? parseRun(row) : null;
}

export const deleteBrowserAutomation = (id: string): boolean => runSqliteWriteTransaction((db) => db.prepare('DELETE FROM browser_automations WHERE automation_id = ?').run(id).changes > 0);

export function saveBrowserAutomationRun(value: BrowserAutomationRun): void { runSqliteWriteTransaction((db) => db.prepare('INSERT INTO browser_automation_runs (run_id, automation_id, automation_revision, definition_json, status, inputs_json, result_json, error, created_at_ms, started_at_ms, ended_at_ms, duration_ms, client_request_id, business_outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET status=excluded.status, result_json=excluded.result_json, error=excluded.error, started_at_ms=excluded.started_at_ms, ended_at_ms=excluded.ended_at_ms, duration_ms=excluded.duration_ms, business_outcome=excluded.business_outcome').run(value.id, value.automationId, value.automationRevision, JSON.stringify(value.definition), value.status, JSON.stringify(value.inputs), value.result === undefined ? null : JSON.stringify(value.result), value.error ?? null, value.createdAtMs, value.startedAtMs ?? null, value.endedAtMs ?? null, value.durationMs ?? null, value.clientRequestId ?? null, value.businessOutcome ?? null)); }
export const getBrowserAutomationRun = (id: string): BrowserAutomationRun | null => { const row = getSqliteDatabase().prepare(`${RUN_SELECT} WHERE run_id = ?`).get(id) as RunRow | undefined; return row ? parseRun(row) : null; };
export const listBrowserAutomationRuns = (automationId?: string): BrowserAutomationRun[] => ((automationId ? getSqliteDatabase().prepare(`${RUN_SELECT} WHERE automation_id = ? ORDER BY created_at_ms DESC`).all(automationId) : getSqliteDatabase().prepare(`${RUN_SELECT} ORDER BY created_at_ms DESC`).all()) as RunRow[]).map(parseRun);
export const listActiveBrowserAutomationRuns = (): BrowserAutomationRun[] => (getSqliteDatabase().prepare(`${RUN_SELECT} WHERE status IN ('queued', 'running')`).all() as RunRow[]).map(parseRun);
export const hasActiveBrowserAutomationRuns = (automationId: string): boolean => Boolean(getSqliteDatabase().prepare("SELECT 1 FROM browser_automation_runs WHERE automation_id = ? AND status IN ('queued', 'running') LIMIT 1").get(automationId));
export const nextBrowserAutomationRunEventSeq = (runId: string): number => ((getSqliteDatabase().prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM browser_action_audit WHERE run_id = ?').get(runId) as { seq: number }).seq);
export function appendBrowserAutomationRunEvent(value: BrowserAutomationRunEvent): void { runSqliteWriteTransaction((db) => db.prepare('INSERT INTO browser_action_audit (event_id, run_id, seq, type, data_json, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)').run(value.id, value.runId, value.seq, value.type, value.data === undefined ? null : JSON.stringify(value.data), value.createdAtMs)); }
export const listBrowserAutomationRunEvents = (runId: string): BrowserAutomationRunEvent[] => (getSqliteDatabase().prepare('SELECT event_id, run_id, seq, type, data_json, created_at_ms FROM browser_action_audit WHERE run_id = ? ORDER BY seq').all(runId) as EventRow[]).map((row) => ({ id: row.event_id, runId: row.run_id, seq: row.seq, type: row.type, data: row.data_json ? JSON.parse(row.data_json) : undefined, createdAtMs: row.created_at_ms }));

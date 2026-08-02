import { randomUUID } from 'node:crypto';

import { requireXopcDatabase } from '../storage/sqlite/connection.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import type {
  WorkUnderstandingEvidenceItem,
  WorkUnderstandingInvestigation,
  WorkUnderstandingInvestigationBudget,
} from './types.js';

interface InvestigationRow {
  investigation_id: string;
  discovery_run_id: string;
  status: string;
  plan_json: string;
  budget_json: string;
  tool_call_count: number;
  content_chars_read: number;
  error_message: string | null;
  started_at: number;
  completed_at: number | null;
}

interface EvidenceRow {
  evidence_id: string;
  investigation_id: string;
  source_grant_id: string | null;
  project_id: string | null;
  source_type: string;
  source_ref: string;
  observation: string;
  content_hash: string | null;
  observed_at: number | null;
  collected_at: number;
  sensitivity: string;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function investigationFromRow(row: InvestigationRow): WorkUnderstandingInvestigation {
  return {
    id: row.investigation_id,
    discoveryRunId: row.discovery_run_id,
    status: row.status as WorkUnderstandingInvestigation['status'],
    plan: parseJson(row.plan_json, { hypotheses: [], questions: [] }),
    budget: parseJson<WorkUnderstandingInvestigationBudget>(row.budget_json, {
      maxToolCalls: 0,
      maxContentChars: 0,
      maxDurationMs: 0,
    }),
    toolCallCount: row.tool_call_count,
    contentCharsRead: row.content_chars_read,
    startedAt: row.started_at,
    ...(row.completed_at != null ? { completedAt: row.completed_at } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
  };
}

function evidenceFromRow(row: EvidenceRow): WorkUnderstandingEvidenceItem {
  return {
    id: row.evidence_id,
    investigationId: row.investigation_id,
    ...(row.source_grant_id ? { sourceGrantId: row.source_grant_id } : {}),
    ...(row.project_id ? { projectId: row.project_id } : {}),
    sourceType: row.source_type as WorkUnderstandingEvidenceItem['sourceType'],
    sourceRef: row.source_ref,
    observation: row.observation,
    ...(row.content_hash ? { contentHash: row.content_hash } : {}),
    ...(row.observed_at != null ? { observedAt: row.observed_at } : {}),
    collectedAt: row.collected_at,
    sensitivity: row.sensitivity === 'restricted' ? 'restricted' : 'normal',
  };
}

export function createWorkUnderstandingInvestigation(input: {
  discoveryRunId: string;
  budget: WorkUnderstandingInvestigationBudget;
  nowMs?: number;
}): WorkUnderstandingInvestigation {
  const now = input.nowMs ?? Date.now();
  const id = randomUUID();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO work_understanding_investigations (
        investigation_id, discovery_run_id, status, plan_json, budget_json,
        tool_call_count, content_chars_read, started_at
      ) VALUES (?, ?, 'planning', ?, ?, 0, 0, ?)`,
    ).run(id, input.discoveryRunId, JSON.stringify({ hypotheses: [], questions: [] }), JSON.stringify(input.budget), now);
  });
  return getWorkUnderstandingInvestigation(id)!;
}

export function getWorkUnderstandingInvestigation(id: string): WorkUnderstandingInvestigation | null {
  const { db } = requireXopcDatabase();
  const row = db.prepare(
    'SELECT * FROM work_understanding_investigations WHERE investigation_id = ?',
  ).get(id) as unknown as InvestigationRow | undefined;
  return row ? investigationFromRow(row) : null;
}

export function getWorkUnderstandingInvestigationForRun(runId: string): WorkUnderstandingInvestigation | null {
  const { db } = requireXopcDatabase();
  const row = db.prepare(
    'SELECT * FROM work_understanding_investigations WHERE discovery_run_id = ?',
  ).get(runId) as unknown as InvestigationRow | undefined;
  return row ? investigationFromRow(row) : null;
}

export function updateWorkUnderstandingInvestigation(
  id: string,
  patch: Partial<Pick<WorkUnderstandingInvestigation,
    'status' | 'plan' | 'toolCallCount' | 'contentCharsRead' | 'completedAt' | 'errorMessage'>>,
): WorkUnderstandingInvestigation | null {
  const existing = getWorkUnderstandingInvestigation(id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE work_understanding_investigations SET
        status = ?, plan_json = ?, tool_call_count = ?, content_chars_read = ?,
        error_message = ?, completed_at = ? WHERE investigation_id = ?`,
    ).run(
      next.status,
      JSON.stringify(next.plan),
      next.toolCallCount,
      next.contentCharsRead,
      next.errorMessage ?? null,
      next.completedAt ?? null,
      id,
    );
  });
  return getWorkUnderstandingInvestigation(id);
}

export function resetWorkUnderstandingInvestigation(
  id: string,
  budget: WorkUnderstandingInvestigationBudget,
  nowMs = Date.now(),
): WorkUnderstandingInvestigation | null {
  const existing = getWorkUnderstandingInvestigation(id);
  if (!existing) return null;
  runSqliteWriteTransaction((db) => {
    db.prepare('DELETE FROM work_understanding_evidence WHERE investigation_id = ?').run(id);
    db.prepare(
      `UPDATE work_understanding_investigations SET
        status = 'planning', plan_json = ?, budget_json = ?, tool_call_count = 0,
        content_chars_read = 0, error_message = NULL, started_at = ?, completed_at = NULL
       WHERE investigation_id = ?`,
    ).run(JSON.stringify({ hypotheses: [], questions: [] }), JSON.stringify(budget), nowMs, id);
  });
  return getWorkUnderstandingInvestigation(id);
}

export function appendWorkUnderstandingEvidence(input: Omit<WorkUnderstandingEvidenceItem, 'id' | 'collectedAt'> & {
  id?: string;
  collectedAt?: number;
}): WorkUnderstandingEvidenceItem {
  const id = input.id ?? randomUUID();
  const collectedAt = input.collectedAt ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO work_understanding_evidence (
        evidence_id, investigation_id, source_grant_id, project_id, source_type,
        source_ref, observation, content_hash, observed_at, collected_at, sensitivity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.investigationId,
      input.sourceGrantId ?? null,
      input.projectId ?? null,
      input.sourceType,
      input.sourceRef,
      input.observation,
      input.contentHash ?? null,
      input.observedAt ?? null,
      collectedAt,
      input.sensitivity,
    );
  });
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM work_understanding_evidence WHERE evidence_id = ?')
    .get(id) as unknown as EvidenceRow;
  return evidenceFromRow(row);
}

export function updateWorkUnderstandingEvidenceObservation(id: string, observation: string): void {
  runSqliteWriteTransaction((db) => {
    db.prepare('UPDATE work_understanding_evidence SET observation = ? WHERE evidence_id = ?')
      .run(observation.slice(0, 1_000), id);
  });
}

export function listWorkUnderstandingEvidence(investigationId: string): WorkUnderstandingEvidenceItem[] {
  const { db } = requireXopcDatabase();
  const rows = db.prepare(
    'SELECT * FROM work_understanding_evidence WHERE investigation_id = ? ORDER BY collected_at ASC',
  ).all(investigationId) as unknown as EvidenceRow[];
  return rows.map(evidenceFromRow);
}

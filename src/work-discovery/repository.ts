import type { DatabaseSync } from 'node:sqlite';

import { requireXopcDatabase } from '../storage/sqlite/connection.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import type {
  WorkDiscoveryOnboardingState,
  WorkDiscoveryOnboardingStatus,
  WorkDiscoveryFeedback,
  WorkDiscoveryRecognitionDecision,
  WorkDiscoveryRun,
} from './types.js';

type OnboardingRow = {
  status: string;
  active_run_id: string | null;
  completed_at: number | null;
  dismissed_at: number | null;
  updated_at: number;
};

type RunRow = {
  id: string;
  idempotency_key: string;
  source: string;
  status: string;
  stage: string | null;
  root_path: string;
  project_id: string;
  session_key: string;
  agent_id: string;
  model_ref: string;
  scan_policy_version: number;
  snapshot_summary_json: string | null;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  canceled_at: number | null;
};

type FeedbackRow = {
  run_id: string;
  recognition_decision: string;
  corrected_intent: string | null;
  created_at: number;
  updated_at: number;
};

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function onboardingFromRow(row: OnboardingRow): WorkDiscoveryOnboardingState {
  return {
    status: row.status as WorkDiscoveryOnboardingStatus,
    ...(row.active_run_id ? { activeRunId: row.active_run_id } : {}),
    ...(row.completed_at != null ? { completedAt: row.completed_at } : {}),
    ...(row.dismissed_at != null ? { dismissedAt: row.dismissed_at } : {}),
    updatedAt: row.updated_at,
  };
}

function runFromRow(row: RunRow): WorkDiscoveryRun {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    source: row.source as WorkDiscoveryRun['source'],
    status: row.status as WorkDiscoveryRun['status'],
    ...(row.stage ? { stage: row.stage as WorkDiscoveryRun['stage'] } : {}),
    rootPath: row.root_path,
    projectId: row.project_id,
    sessionKey: row.session_key,
    agentId: row.agent_id,
    modelRef: row.model_ref,
    scanPolicyVersion: row.scan_policy_version,
    ...(parseJson<WorkDiscoveryRun['snapshot']>(row.snapshot_summary_json)
      ? { snapshot: parseJson<WorkDiscoveryRun['snapshot']>(row.snapshot_summary_json) }
      : {}),
    ...(parseJson<WorkDiscoveryRun['result']>(row.result_json)
      ? { result: parseJson<WorkDiscoveryRun['result']>(row.result_json) }
      : {}),
    ...(row.error_code ? { errorCode: row.error_code as WorkDiscoveryRun['errorCode'] } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    createdAt: row.created_at,
    ...(row.started_at != null ? { startedAt: row.started_at } : {}),
    ...(row.completed_at != null ? { completedAt: row.completed_at } : {}),
    ...(row.canceled_at != null ? { canceledAt: row.canceled_at } : {}),
  };
}

function readRun(db: DatabaseSync, clause: string, value: string): WorkDiscoveryRun | null {
  const row = db.prepare(`SELECT * FROM work_discovery_runs WHERE ${clause} = ?`).get(value) as RunRow | undefined;
  if (!row) return null;
  const run = runFromRow(row);
  const feedback = getWorkDiscoveryFeedbackFromDb(db, run.id);
  return feedback ? { ...run, feedback } : run;
}

function feedbackFromRow(row: FeedbackRow): WorkDiscoveryFeedback {
  return {
    runId: row.run_id,
    recognitionDecision: row.recognition_decision as WorkDiscoveryRecognitionDecision,
    ...(row.corrected_intent ? { correctedIntent: row.corrected_intent } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getWorkDiscoveryFeedbackFromDb(db: DatabaseSync, runId: string): WorkDiscoveryFeedback | null {
  const row = db.prepare('SELECT * FROM work_discovery_feedback WHERE run_id = ?').get(runId) as FeedbackRow | undefined;
  return row ? feedbackFromRow(row) : null;
}

export function getWorkDiscoveryOnboardingState(): WorkDiscoveryOnboardingState {
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM work_discovery_onboarding WHERE singleton_id = 1').get() as OnboardingRow;
  return onboardingFromRow(row);
}

export function setWorkDiscoveryOnboardingState(input: {
  status: WorkDiscoveryOnboardingStatus;
  activeRunId?: string | null;
  nowMs?: number;
}): WorkDiscoveryOnboardingState {
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE work_discovery_onboarding
       SET status = ?, active_run_id = ?,
           completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
           dismissed_at = CASE WHEN ? = 'dismissed' THEN ? ELSE dismissed_at END,
           updated_at = ?
       WHERE singleton_id = 1`,
    ).run(input.status, input.activeRunId ?? null, input.status, now, input.status, now, now);
  });
  return getWorkDiscoveryOnboardingState();
}

export function createWorkDiscoveryRun(run: WorkDiscoveryRun): WorkDiscoveryRun {
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO work_discovery_runs (
        id, idempotency_key, source, status, stage, root_path, project_id, session_key,
        agent_id, model_ref, scan_policy_version, snapshot_summary_json, result_json,
        error_code, error_message, created_at, started_at, completed_at, canceled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      run.id,
      run.idempotencyKey,
      run.source,
      run.status,
      run.stage ?? null,
      run.rootPath,
      run.projectId,
      run.sessionKey,
      run.agentId,
      run.modelRef,
      run.scanPolicyVersion,
      run.snapshot ? JSON.stringify(run.snapshot) : null,
      run.result ? JSON.stringify(run.result) : null,
      run.errorCode ?? null,
      run.errorMessage ?? null,
      run.createdAt,
      run.startedAt ?? null,
      run.completedAt ?? null,
      run.canceledAt ?? null,
    );
  });
  return getWorkDiscoveryRun(run.id)!;
}

export function getWorkDiscoveryRun(id: string): WorkDiscoveryRun | null {
  const { db } = requireXopcDatabase();
  return readRun(db, 'id', id);
}

export function getWorkDiscoveryRunByIdempotencyKey(key: string): WorkDiscoveryRun | null {
  const { db } = requireXopcDatabase();
  return readRun(db, 'idempotency_key', key);
}

export function setWorkDiscoveryFeedback(input: {
  runId: string;
  recognitionDecision: WorkDiscoveryRecognitionDecision;
  correctedIntent?: string;
  nowMs?: number;
}): WorkDiscoveryFeedback {
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO work_discovery_feedback (
        run_id, recognition_decision, corrected_intent, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        recognition_decision = excluded.recognition_decision,
        corrected_intent = excluded.corrected_intent,
        updated_at = excluded.updated_at`,
    ).run(
      input.runId,
      input.recognitionDecision,
      input.correctedIntent ?? null,
      now,
      now,
    );
  });
  const { db } = requireXopcDatabase();
  return getWorkDiscoveryFeedbackFromDb(db, input.runId)!;
}

export function updateWorkDiscoveryRun(
  id: string,
  patch: Partial<Pick<
    WorkDiscoveryRun,
    | 'status'
    | 'stage'
    | 'snapshot'
    | 'result'
    | 'errorCode'
    | 'errorMessage'
    | 'startedAt'
    | 'completedAt'
    | 'canceledAt'
  >>,
): WorkDiscoveryRun | null {
  const existing = getWorkDiscoveryRun(id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE work_discovery_runs SET
        status = ?, stage = ?, snapshot_summary_json = ?, result_json = ?,
        error_code = ?, error_message = ?, started_at = ?, completed_at = ?, canceled_at = ?
       WHERE id = ?`,
    ).run(
      next.status,
      next.stage ?? null,
      next.snapshot ? JSON.stringify(next.snapshot) : null,
      next.result ? JSON.stringify(next.result) : null,
      next.errorCode ?? null,
      next.errorMessage ?? null,
      next.startedAt ?? null,
      next.completedAt ?? null,
      next.canceledAt ?? null,
      id,
    );
  });
  return getWorkDiscoveryRun(id);
}

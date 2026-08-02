import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';
import {
  diagnoseTaskFailure,
  verifyTaskCompletion,
  type TaskFailureCode,
  type TaskFailurePhase,
  type TaskRecoveryAction,
  type TaskVerification,
  type TaskVerificationStatus,
} from '../../agent/outcomes/task-verifier.js';

export type TaskOutcomeStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';
export type TaskFeedbackOutcome = 'helpful' | 'not_helpful';

export interface TaskContract {
  objective: string;
  deliverables: string[];
  acceptanceCriteria: string[];
  constraints: string[];
  approvalRequired: string[];
}

export interface TaskEvidence {
  kind: 'artifact' | 'test' | 'state' | 'source';
  title: string;
  summary: string;
  uri?: string;
  verifies?: string[];
}

export interface TaskOutcome {
  runId: string;
  sessionKey: string;
  channel: string;
  objective: string;
  status: TaskOutcomeStatus;
  summary?: string;
  contract?: TaskContract;
  evidence: TaskEvidence[];
  verification: TaskVerification;
  failure?: {
    code: TaskFailureCode;
    phase: TaskFailurePhase;
    recoveryAction: TaskRecoveryAction;
  };
  feedback?: {
    outcome: TaskFeedbackOutcome;
    reason?: string;
    needsCorrection?: boolean;
    supportFit?: boolean;
  };
  startedAt: number;
  completedAt?: number;
  updatedAt: number;
}

type TaskOutcomeRow = {
  run_id: string;
  session_key: string;
  channel: string;
  objective: string;
  status: TaskOutcomeStatus;
  summary: string | null;
  contract_json: string | null;
  evidence_json: string;
  feedback_outcome: TaskFeedbackOutcome | null;
  feedback_reason: string | null;
  needs_correction: number | null;
  support_fit: number | null;
  started_at: number;
  completed_at: number | null;
  updated_at: number;
  verification_status: TaskVerificationStatus;
  verification_json: string;
  failure_code: TaskFailureCode | null;
  failure_phase: TaskFailurePhase | null;
  recovery_action: TaskRecoveryAction | null;
};

export interface TaskOutcomeMetrics {
  total: number;
  completed: number;
  succeeded: number;
  verified: number;
  helpful: number;
  notHelpful: number;
  completionRate: number;
  successRate: number;
  verificationRate: number;
  helpfulRate: number;
}

function fromRow(row: TaskOutcomeRow): TaskOutcome {
  const contract = row.contract_json ? JSON.parse(row.contract_json) as TaskContract : undefined;
  const evidence = JSON.parse(row.evidence_json) as TaskEvidence[];
  const feedback = row.feedback_outcome
    ? {
        outcome: row.feedback_outcome,
        ...(row.feedback_reason ? { reason: row.feedback_reason } : {}),
        ...(row.needs_correction === null ? {} : { needsCorrection: row.needs_correction === 1 }),
        ...(row.support_fit === null ? {} : { supportFit: row.support_fit === 1 }),
      }
    : undefined;
  return {
    runId: row.run_id,
    sessionKey: row.session_key,
    channel: row.channel,
    objective: row.objective,
    status: row.status,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(contract ? { contract } : {}),
    evidence,
    verification: {
      ...(JSON.parse(row.verification_json) as Omit<TaskVerification, 'status'>),
      status: row.verification_status,
    },
    ...(row.failure_code && row.failure_phase && row.recovery_action ? {
      failure: {
        code: row.failure_code,
        phase: row.failure_phase,
        recoveryAction: row.recovery_action,
      },
    } : {}),
    ...(feedback ? { feedback } : {}),
    startedAt: row.started_at,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `run_id, session_key, channel, objective, status, summary,
  contract_json, evidence_json, feedback_outcome, feedback_reason,
  needs_correction, support_fit, started_at, completed_at, updated_at,
  verification_status, verification_json, failure_code, failure_phase, recovery_action`;

export function startTaskOutcome(input: {
  runId: string;
  sessionKey: string;
  channel: string;
  objective: string;
  now?: number;
}): TaskOutcome {
  const now = input.now ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO task_outcomes (
        run_id, session_key, channel, objective, status, started_at, updated_at
      ) VALUES (?, ?, ?, ?, 'running', ?, ?)`,
    ).run(input.runId, input.sessionKey, input.channel, input.objective, now, now);
  });
  return getTaskOutcome(input.runId)!;
}

export function completeTaskOutcome(input: {
  runId: string;
  status: Exclude<TaskOutcomeStatus, 'running'>;
  summary: string;
  now?: number;
}): TaskOutcome | undefined {
  const now = input.now ?? Date.now();
  const current = getTaskOutcome(input.runId);
  if (!current) return undefined;
  const verification = verifyTaskCompletion({
    status: input.status,
    acceptanceCriteria: current.contract?.acceptanceCriteria ?? [],
    evidence: current.evidence,
  });
  const failure = input.status === 'succeeded'
    ? undefined
    : diagnoseTaskFailure({ status: input.status, summary: input.summary });
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE task_outcomes
       SET status = ?, summary = ?, completed_at = ?, updated_at = ?,
           verification_status = ?, verification_json = ?, failure_code = ?,
           failure_phase = ?, recovery_action = ?
       WHERE run_id = ?`,
    ).run(
      input.status,
      input.summary,
      now,
      now,
      verification.status,
      JSON.stringify({ checks: verification.checks }),
      failure?.code ?? null,
      failure?.phase ?? null,
      failure?.recoveryAction ?? null,
      input.runId,
    );
  });
  return getTaskOutcome(input.runId);
}

export function updateTaskOutcome(input: {
  runId: string;
  contract?: TaskContract;
  evidence?: TaskEvidence[];
  summary?: string;
  now?: number;
}): TaskOutcome | undefined {
  const current = getTaskOutcome(input.runId);
  if (!current) return undefined;
  const now = input.now ?? Date.now();
  const contract = input.contract === undefined ? current.contract : input.contract;
  const evidence = input.evidence === undefined ? current.evidence : input.evidence;
  const summary = input.summary === undefined ? current.summary : input.summary;
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE task_outcomes
       SET contract_json = ?, evidence_json = ?, summary = ?, updated_at = ?
       WHERE run_id = ?`,
    ).run(
      contract ? JSON.stringify(contract) : null,
      JSON.stringify(evidence),
      summary ?? null,
      now,
      input.runId,
    );
  });
  return getTaskOutcome(input.runId);
}

export function setTaskOutcomeFeedback(input: {
  sessionKey: string;
  assistantTimestamp: number;
  outcome: TaskFeedbackOutcome;
  reason?: string;
  needsCorrection?: boolean;
  supportFit?: boolean;
  now?: number;
}): TaskOutcome | undefined {
  const matched = findTaskOutcomeForAssistant(input.sessionKey, input.assistantTimestamp);
  if (!matched) return undefined;
  const now = input.now ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE task_outcomes
       SET feedback_outcome = ?, feedback_reason = ?, needs_correction = ?, support_fit = ?, updated_at = ?
       WHERE run_id = ?`,
    ).run(
      input.outcome,
      input.reason ?? null,
      input.needsCorrection === undefined ? null : Number(input.needsCorrection),
      input.supportFit === undefined ? null : Number(input.supportFit),
      now,
      matched.runId,
    );
  });
  return getTaskOutcome(matched.runId);
}

export function getTaskOutcome(runId: string): TaskOutcome | undefined {
  const row = getSqliteDatabase()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM task_outcomes WHERE run_id = ?`)
    .get(runId) as TaskOutcomeRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function findTaskOutcomeForAssistant(
  sessionKey: string,
  assistantTimestamp: number,
): TaskOutcome | undefined {
  const row = getSqliteDatabase()
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM task_outcomes
       WHERE session_key = ?
         AND started_at <= ?
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .get(sessionKey, assistantTimestamp) as TaskOutcomeRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function listTaskOutcomes(input: {
  sessionKey?: string;
  limit?: number;
} = {}): TaskOutcome[] {
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 50)));
  const rows = input.sessionKey
    ? getSqliteDatabase()
        .prepare(`SELECT ${SELECT_COLUMNS} FROM task_outcomes WHERE session_key = ? ORDER BY started_at DESC LIMIT ?`)
        .all(input.sessionKey, limit)
    : getSqliteDatabase()
        .prepare(`SELECT ${SELECT_COLUMNS} FROM task_outcomes ORDER BY started_at DESC LIMIT ?`)
        .all(limit);
  return rows.map((row) => fromRow(row as TaskOutcomeRow));
}

export function summarizeTaskOutcomes(): TaskOutcomeMetrics {
  const row = getSqliteDatabase()
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status != 'running' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
        SUM(CASE WHEN verification_status = 'passed' THEN 1 ELSE 0 END) AS verified,
        SUM(CASE WHEN feedback_outcome = 'helpful' THEN 1 ELSE 0 END) AS helpful,
        SUM(CASE WHEN feedback_outcome = 'not_helpful' THEN 1 ELSE 0 END) AS not_helpful
       FROM task_outcomes`,
    )
    .get() as {
      total: number;
      completed: number;
      succeeded: number;
      verified: number;
      helpful: number;
      not_helpful: number;
    };
  const rated = row.helpful + row.not_helpful;
  return {
    total: row.total,
    completed: row.completed,
    succeeded: row.succeeded,
    verified: row.verified,
    helpful: row.helpful,
    notHelpful: row.not_helpful,
    completionRate: row.total ? row.completed / row.total : 0,
    successRate: row.completed ? row.succeeded / row.completed : 0,
    verificationRate: row.completed ? row.verified / row.completed : 0,
    helpfulRate: rated ? row.helpful / rated : 0,
  };
}

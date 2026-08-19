import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';
import {
  diagnoseExecutionFailure,
  verifyExecutionCompletion,
  type ExecutionFailureCode,
  type ExecutionFailurePhase,
  type ExecutionRecoveryAction,
  type ExecutionVerification,
  type ExecutionVerificationStatus,
} from '../../agent/tasks/execution-verifier.js';

export type ExecutionReceiptStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ExecutionFeedbackRating = 'helpful' | 'not_helpful';
export type ExecutionVerdict = 'achieved' | 'partial' | 'not_achieved';
export type ExecutionReceiptOrigin = 'chat' | 'task' | 'workflow' | 'automation' | 'browser' | 'proactive';
export type ExecutionReceiptTrigger = 'user' | 'schedule' | 'webhook' | 'proactive' | 'retry';

export interface ExecutionReceiptContext {
  taskId?: string;
  projectId?: string;
  origin?: ExecutionReceiptOrigin;
  triggerKind?: ExecutionReceiptTrigger;
  parentRunId?: string;
  contextTraceId?: string;
}

export interface ExecutionContract {
  objective: string;
  expectedOutputs: string[];
  acceptanceCriteria: string[];
  constraints: string[];
  approvalRequired: string[];
  assumptions: string[];
  risks: string[];
}

export interface ExecutionEvidence {
  kind: 'artifact' | 'test' | 'state' | 'source';
  title: string;
  summary: string;
  uri?: string;
  verifies?: string[];
  provenance: 'tool' | 'external' | 'user' | 'judge';
  strength: 'observed' | 'verified';
  observedAt: number;
}

export interface ExecutionJudgment {
  recommendation: string;
  reasons: string[];
  rejectedAlternatives: Array<{ option: string; reason: string }>;
  uncertainty?: string;
  confidence: number;
}

export interface ExecutionReceipt {
  runId: string;
  sessionKey: string;
  channel: string;
  objective: string;
  status: ExecutionReceiptStatus;
  summary?: string;
  contract?: ExecutionContract;
  contractVersion?: number;
  attempt: number;
  strategy?: string;
  evidence: ExecutionEvidence[];
  verification: ExecutionVerification;
  context: ExecutionReceiptContext;
  nextAction?: string;
  needsUser: boolean;
  completionVerdict?: ExecutionVerdict;
  completionVerdictSource?: 'system' | 'user';
  correctionText?: string;
  judgment?: ExecutionJudgment;
  projectionVersion: number;
  projectedAt?: number;
  failure?: {
    code: ExecutionFailureCode;
    phase: ExecutionFailurePhase;
    recoveryAction: ExecutionRecoveryAction;
  };
  feedback?: {
    rating: ExecutionFeedbackRating;
    reason?: string;
    needsCorrection?: boolean;
    supportFit?: boolean;
  };
  startedAt: number;
  completedAt?: number;
  updatedAt: number;
}

type ExecutionReceiptRow = {
  run_id: string;
  session_key: string;
  channel: string;
  objective: string;
  status: ExecutionReceiptStatus;
  summary: string | null;
  contract_json: string | null;
  evidence_json: string;
  feedback_rating: ExecutionFeedbackRating | null;
  feedback_reason: string | null;
  needs_correction: number | null;
  support_fit: number | null;
  started_at: number;
  completed_at: number | null;
  updated_at: number;
  verification_status: ExecutionVerificationStatus;
  verification_json: string;
  failure_code: ExecutionFailureCode | null;
  failure_phase: ExecutionFailurePhase | null;
  recovery_action: ExecutionRecoveryAction | null;
  project_id: string | null;
  origin: ExecutionReceiptOrigin | null;
  trigger_kind: ExecutionReceiptTrigger | null;
  parent_run_id: string | null;
  next_action: string | null;
  needs_user: number;
  context_trace_id: string | null;
  completion_verdict: ExecutionVerdict | null;
  completion_verdict_source: 'system' | 'user' | null;
  correction_text: string | null;
  projection_version: number;
  projected_at: number | null;
  task_id: string | null;
  contract_version: number | null;
  attempt: number;
  strategy: string | null;
  judgment_json: string | null;
};

export interface ExecutionReceiptMetrics {
  total: number;
  completed: number;
  succeeded: number;
  verified: number;
  helpful: number;
  notHelpful: number;
  supportFit: number;
  completionRate: number;
  successRate: number;
  verificationRate: number;
  helpfulRate: number;
  supportFitRate: number;
}

function fromRow(row: ExecutionReceiptRow): ExecutionReceipt {
  const contract = row.contract_json ? JSON.parse(row.contract_json) as ExecutionContract : undefined;
  const evidence = JSON.parse(row.evidence_json) as ExecutionEvidence[];
  const feedback = row.feedback_rating
    ? {
        rating: row.feedback_rating,
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
    ...(row.contract_version === null ? {} : { contractVersion: row.contract_version }),
    attempt: row.attempt,
    ...(row.strategy ? { strategy: row.strategy } : {}),
    evidence,
    verification: {
      ...(JSON.parse(row.verification_json) as Omit<ExecutionVerification, 'status'>),
      status: row.verification_status,
    },
    context: {
      ...(row.task_id ? { taskId: row.task_id } : {}),
      ...(row.project_id ? { projectId: row.project_id } : {}),
      ...(row.origin ? { origin: row.origin } : {}),
      ...(row.trigger_kind ? { triggerKind: row.trigger_kind } : {}),
      ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {}),
      ...(row.context_trace_id ? { contextTraceId: row.context_trace_id } : {}),
    },
    ...(row.next_action ? { nextAction: row.next_action } : {}),
    needsUser: row.needs_user === 1,
    ...(row.completion_verdict ? { completionVerdict: row.completion_verdict } : {}),
    ...(row.completion_verdict_source ? { completionVerdictSource: row.completion_verdict_source } : {}),
    ...(row.correction_text ? { correctionText: row.correction_text } : {}),
    ...(row.judgment_json
      ? { judgment: JSON.parse(row.judgment_json) as ExecutionJudgment }
      : {}),
    projectionVersion: row.projection_version,
    ...(row.projected_at === null ? {} : { projectedAt: row.projected_at }),
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
  contract_json, evidence_json, feedback_rating, feedback_reason,
  needs_correction, support_fit, started_at, completed_at, updated_at,
  verification_status, verification_json, failure_code, failure_phase, recovery_action,
  project_id, origin, trigger_kind, parent_run_id,
  next_action, needs_user, context_trace_id, completion_verdict, completion_verdict_source, correction_text,
  projection_version, projected_at, task_id, contract_version, attempt, strategy, judgment_json`;

export function startExecutionReceipt(input: {
  runId: string;
  sessionKey: string;
  channel: string;
  objective: string;
  context?: ExecutionReceiptContext;
  contract?: ExecutionContract;
  contractVersion?: number;
  attempt?: number;
  strategy?: string;
  now?: number;
}): ExecutionReceipt {
  const now = input.now ?? Date.now();
  runSqliteWriteTransaction((db) => {
    const previousAttempt = input.context?.taskId
      ? (db.prepare(
          'SELECT COALESCE(MAX(attempt), 0) AS attempt FROM execution_receipts WHERE task_id = ?',
        ).get(input.context.taskId) as { attempt: number }).attempt
      : 0;
    const attempt = input.attempt ?? previousAttempt + 1;
    const strategy = input.strategy ?? (attempt === 1 ? 'primary' : `continuation_${attempt}`);
    db.prepare(
      `INSERT INTO execution_receipts (
        run_id, session_key, channel, objective, status, contract_json, started_at, updated_at,
        project_id, origin, trigger_kind, parent_run_id, context_trace_id,
        task_id, contract_version, attempt, strategy
      ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.runId,
      input.sessionKey,
      input.channel,
      input.objective,
      input.contract ? JSON.stringify(input.contract) : null,
      now,
      now,
      input.context?.projectId ?? null,
      input.context?.origin ?? null,
      input.context?.triggerKind ?? null,
      input.context?.parentRunId ?? null,
      input.context?.contextTraceId ?? null,
      input.context?.taskId ?? null,
      input.contractVersion ?? null,
      attempt,
      strategy,
    );
  });
  return getExecutionReceipt(input.runId)!;
}

export function completeExecutionReceipt(input: {
  runId: string;
  status: Exclude<ExecutionReceiptStatus, 'running'>;
  summary: string;
  now?: number;
}): ExecutionReceipt | undefined {
  const now = input.now ?? Date.now();
  const current = getExecutionReceipt(input.runId);
  if (!current) return undefined;
  const verification = verifyExecutionCompletion({
    status: input.status,
    acceptanceCriteria: current.contract?.acceptanceCriteria ?? [],
    evidence: current.evidence,
    startedAt: current.startedAt,
  });
  const failure = input.status === 'succeeded'
    ? undefined
    : diagnoseExecutionFailure({ status: input.status, summary: input.summary });
  const completionVerdict: ExecutionVerdict = input.status === 'succeeded'
    ? verification.status === 'passed' ? 'achieved' : 'partial'
    : 'not_achieved';
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE execution_receipts
       SET status = ?, summary = ?, completed_at = ?, updated_at = ?,
           verification_status = ?, verification_json = ?, failure_code = ?,
           failure_phase = ?, recovery_action = ?, completion_verdict = ?,
           completion_verdict_source = 'system', correction_text = NULL,
           projection_version = 0, projected_at = NULL
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
      completionVerdict,
      input.runId,
    );
  });
  return getExecutionReceipt(input.runId);
}

export function setExecutionVerdict(input: {
  runId: string;
  verdict: ExecutionVerdict;
  correctionText?: string;
  now?: number;
}): ExecutionReceipt | undefined {
  const current = getExecutionReceipt(input.runId);
  if (!current || current.status === 'running') return undefined;
  const now = input.now ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE execution_receipts
       SET completion_verdict = ?, completion_verdict_source = 'user', correction_text = ?, projection_version = 0,
           projected_at = NULL, updated_at = ?
       WHERE run_id = ?`,
    ).run(
      input.verdict,
      input.correctionText?.trim() || null,
      now,
      input.runId,
    );
  });
  return getExecutionReceipt(input.runId);
}

export function markExecutionReceiptProjected(input: {
  runId: string;
  projectionVersion: number;
  now?: number;
}): ExecutionReceipt | undefined {
  const now = input.now ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE execution_receipts
       SET projection_version = ?, projected_at = ?, updated_at = ?
       WHERE run_id = ? AND status != 'running'`,
    ).run(input.projectionVersion, now, now, input.runId);
  });
  return getExecutionReceipt(input.runId);
}

export function listUnprojectedExecutionReceipts(input: {
  projectionVersion: number;
  limit?: number;
}): ExecutionReceipt[] {
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM execution_receipts
       WHERE status != 'running' AND projection_version < ?
       ORDER BY completed_at ASC
       LIMIT ?`,
    )
    .all(input.projectionVersion, limit) as ExecutionReceiptRow[];
  return rows.map(fromRow);
}

export function updateExecutionReceipt(input: {
  runId: string;
  contract?: ExecutionContract;
  evidence?: ExecutionEvidence[];
  summary?: string;
  nextAction?: string | null;
  needsUser?: boolean;
  contextTraceId?: string | null;
  judgment?: ExecutionJudgment | null;
  now?: number;
}): ExecutionReceipt | undefined {
  const current = getExecutionReceipt(input.runId);
  if (!current) return undefined;
  const now = input.now ?? Date.now();
  const contract = input.contract === undefined ? current.contract : input.contract;
  const evidence = input.evidence === undefined ? current.evidence : input.evidence;
  const summary = input.summary === undefined ? current.summary : input.summary;
  const nextAction = input.nextAction === undefined ? current.nextAction : input.nextAction ?? undefined;
  const needsUser = input.needsUser === undefined ? current.needsUser : input.needsUser;
  const contextTraceId = input.contextTraceId === undefined
    ? current.context.contextTraceId
    : input.contextTraceId ?? undefined;
  const judgment = input.judgment === undefined ? current.judgment : input.judgment ?? undefined;
  const verification = current.status !== 'running' && current.completionVerdictSource !== 'user'
    ? verifyExecutionCompletion({
        status: current.status,
        acceptanceCriteria: contract?.acceptanceCriteria ?? [],
        evidence,
        startedAt: current.startedAt,
      })
    : current.verification;
  const completionVerdict = current.status !== 'running' && current.completionVerdictSource !== 'user'
    ? current.status === 'succeeded'
      ? verification.status === 'passed' ? 'achieved' : 'partial'
      : 'not_achieved'
    : current.completionVerdict;
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE execution_receipts
       SET contract_json = ?, evidence_json = ?, summary = ?, next_action = ?,
           needs_user = ?, context_trace_id = ?, verification_status = ?,
           verification_json = ?, completion_verdict = ?, judgment_json = ?,
           projection_version = CASE WHEN status = 'running' THEN projection_version ELSE 0 END,
           projected_at = CASE WHEN status = 'running' THEN projected_at ELSE NULL END,
           updated_at = ?
       WHERE run_id = ?`,
    ).run(
      contract ? JSON.stringify(contract) : null,
      JSON.stringify(evidence),
      summary ?? null,
      nextAction ?? null,
      Number(needsUser),
      contextTraceId ?? null,
      verification.status,
      JSON.stringify({ checks: verification.checks }),
      completionVerdict ?? null,
      judgment ? JSON.stringify(judgment) : null,
      now,
      input.runId,
    );
  });
  return getExecutionReceipt(input.runId);
}

type ExecutionReceiptFeedbackInput = {
  rating: ExecutionFeedbackRating;
  reason?: string;
  needsCorrection?: boolean;
  supportFit?: boolean;
  now?: number;
};

function persistExecutionReceiptFeedback(runId: string, input: ExecutionReceiptFeedbackInput): ExecutionReceipt {
  const now = input.now ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE execution_receipts
       SET feedback_rating = ?, feedback_reason = ?, needs_correction = ?, support_fit = ?, updated_at = ?
       WHERE run_id = ?`,
    ).run(
      input.rating,
      input.reason ?? null,
      input.needsCorrection === undefined ? null : Number(input.needsCorrection),
      input.supportFit === undefined ? null : Number(input.supportFit),
      now,
      runId,
    );
  });
  return getExecutionReceipt(runId)!;
}

export function setExecutionReceiptFeedback(input: ExecutionReceiptFeedbackInput & {
  sessionKey: string;
  assistantTimestamp: number;
}): ExecutionReceipt | undefined {
  const matched = findExecutionReceiptForAssistant(input.sessionKey, input.assistantTimestamp);
  return matched ? persistExecutionReceiptFeedback(matched.runId, input) : undefined;
}

export function setExecutionReceiptFeedbackByRunId(input: ExecutionReceiptFeedbackInput & {
  runId: string;
}): ExecutionReceipt | undefined {
  const current = getExecutionReceipt(input.runId);
  return current ? persistExecutionReceiptFeedback(input.runId, input) : undefined;
}

export function getExecutionReceipt(runId: string): ExecutionReceipt | undefined {
  const row = getSqliteDatabase()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM execution_receipts WHERE run_id = ?`)
    .get(runId) as ExecutionReceiptRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function findExecutionReceiptForAssistant(
  sessionKey: string,
  assistantTimestamp: number,
): ExecutionReceipt | undefined {
  const row = getSqliteDatabase()
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM execution_receipts
       WHERE session_key = ?
         AND started_at <= ?
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .get(sessionKey, assistantTimestamp) as ExecutionReceiptRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function listExecutionReceipts(input: {
  taskId?: string;
  sessionKey?: string;
  projectId?: string;
  limit?: number;
} = {}): ExecutionReceipt[] {
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 50)));
  const filters: string[] = [];
  const values: Array<string | number> = [];
  if (input.taskId) {
    filters.push('task_id = ?');
    values.push(input.taskId);
  }
  if (input.sessionKey) {
    filters.push('session_key = ?');
    values.push(input.sessionKey);
  }
  if (input.projectId) {
    filters.push('project_id = ?');
    values.push(input.projectId);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = getSqliteDatabase()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM execution_receipts ${where} ORDER BY started_at DESC LIMIT ?`)
    .all(...values, limit);
  return rows.map((row) => fromRow(row as ExecutionReceiptRow));
}

export function summarizeExecutionReceipts(): ExecutionReceiptMetrics {
  const row = getSqliteDatabase()
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status != 'running' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
        SUM(CASE WHEN verification_status = 'passed' THEN 1 ELSE 0 END) AS verified,
        SUM(CASE WHEN feedback_rating = 'helpful' THEN 1 ELSE 0 END) AS helpful,
        SUM(CASE WHEN feedback_rating = 'not_helpful' THEN 1 ELSE 0 END) AS not_helpful,
        SUM(CASE WHEN support_fit = 1 THEN 1 ELSE 0 END) AS support_fit,
        SUM(CASE WHEN support_fit IS NOT NULL THEN 1 ELSE 0 END) AS support_fit_rated
       FROM execution_receipts`,
    )
    .get() as {
      total: number;
      completed: number;
      succeeded: number;
      verified: number;
      helpful: number;
      not_helpful: number;
      support_fit: number;
      support_fit_rated: number;
    };
  const rated = row.helpful + row.not_helpful;
  return {
    total: row.total,
    completed: row.completed,
    succeeded: row.succeeded,
    verified: row.verified,
    helpful: row.helpful,
    notHelpful: row.not_helpful,
    supportFit: row.support_fit,
    completionRate: row.total ? row.completed / row.total : 0,
    successRate: row.completed ? row.succeeded / row.completed : 0,
    verificationRate: row.completed ? row.verified / row.completed : 0,
    helpfulRate: rated ? row.helpful / rated : 0,
    supportFitRate: row.support_fit_rated ? row.support_fit / row.support_fit_rated : 0,
  };
}

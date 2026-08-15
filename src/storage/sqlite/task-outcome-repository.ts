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
export type TaskOutcomeOrigin = 'chat' | 'goal' | 'workflow' | 'automation' | 'browser' | 'proactive';
export type TaskOutcomeTrigger = 'user' | 'schedule' | 'webhook' | 'proactive' | 'retry';

export interface TaskOutcomeContext {
  projectId?: string;
  goalId?: string;
  workItemId?: string;
  origin?: TaskOutcomeOrigin;
  triggerKind?: TaskOutcomeTrigger;
  parentRunId?: string;
  contextTraceId?: string;
}

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
  context: TaskOutcomeContext;
  nextAction?: string;
  needsUser: boolean;
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
  project_id: string | null;
  goal_id: string | null;
  work_item_id: string | null;
  origin: TaskOutcomeOrigin | null;
  trigger_kind: TaskOutcomeTrigger | null;
  parent_run_id: string | null;
  next_action: string | null;
  needs_user: number;
  context_trace_id: string | null;
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
    context: {
      ...(row.project_id ? { projectId: row.project_id } : {}),
      ...(row.goal_id ? { goalId: row.goal_id } : {}),
      ...(row.work_item_id ? { workItemId: row.work_item_id } : {}),
      ...(row.origin ? { origin: row.origin } : {}),
      ...(row.trigger_kind ? { triggerKind: row.trigger_kind } : {}),
      ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {}),
      ...(row.context_trace_id ? { contextTraceId: row.context_trace_id } : {}),
    },
    ...(row.next_action ? { nextAction: row.next_action } : {}),
    needsUser: row.needs_user === 1,
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
  verification_status, verification_json, failure_code, failure_phase, recovery_action,
  project_id, goal_id, work_item_id, origin, trigger_kind, parent_run_id,
  next_action, needs_user, context_trace_id`;

export function startTaskOutcome(input: {
  runId: string;
  sessionKey: string;
  channel: string;
  objective: string;
  context?: TaskOutcomeContext;
  now?: number;
}): TaskOutcome {
  const now = input.now ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO task_outcomes (
        run_id, session_key, channel, objective, status, started_at, updated_at,
        project_id, goal_id, work_item_id, origin, trigger_kind, parent_run_id, context_trace_id
      ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.runId,
      input.sessionKey,
      input.channel,
      input.objective,
      now,
      now,
      input.context?.projectId ?? null,
      input.context?.goalId ?? null,
      input.context?.workItemId ?? null,
      input.context?.origin ?? null,
      input.context?.triggerKind ?? null,
      input.context?.parentRunId ?? null,
      input.context?.contextTraceId ?? null,
    );
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
  nextAction?: string | null;
  needsUser?: boolean;
  contextTraceId?: string | null;
  now?: number;
}): TaskOutcome | undefined {
  const current = getTaskOutcome(input.runId);
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
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE task_outcomes
       SET contract_json = ?, evidence_json = ?, summary = ?, next_action = ?,
           needs_user = ?, context_trace_id = ?, updated_at = ?
       WHERE run_id = ?`,
    ).run(
      contract ? JSON.stringify(contract) : null,
      JSON.stringify(evidence),
      summary ?? null,
      nextAction ?? null,
      Number(needsUser),
      contextTraceId ?? null,
      now,
      input.runId,
    );
  });
  return getTaskOutcome(input.runId);
}

type TaskOutcomeFeedbackInput = {
  outcome: TaskFeedbackOutcome;
  reason?: string;
  needsCorrection?: boolean;
  supportFit?: boolean;
  now?: number;
};

function persistTaskOutcomeFeedback(runId: string, input: TaskOutcomeFeedbackInput): TaskOutcome {
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
      runId,
    );
  });
  return getTaskOutcome(runId)!;
}

export function setTaskOutcomeFeedback(input: TaskOutcomeFeedbackInput & {
  sessionKey: string;
  assistantTimestamp: number;
}): TaskOutcome | undefined {
  const matched = findTaskOutcomeForAssistant(input.sessionKey, input.assistantTimestamp);
  return matched ? persistTaskOutcomeFeedback(matched.runId, input) : undefined;
}

export function setTaskOutcomeFeedbackByRunId(input: TaskOutcomeFeedbackInput & {
  runId: string;
}): TaskOutcome | undefined {
  const current = getTaskOutcome(input.runId);
  return current ? persistTaskOutcomeFeedback(input.runId, input) : undefined;
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
  projectId?: string;
  workItemId?: string;
  limit?: number;
} = {}): TaskOutcome[] {
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 50)));
  const filters: string[] = [];
  const values: Array<string | number> = [];
  if (input.sessionKey) {
    filters.push('session_key = ?');
    values.push(input.sessionKey);
  }
  if (input.projectId) {
    filters.push('project_id = ?');
    values.push(input.projectId);
  }
  if (input.workItemId) {
    filters.push('work_item_id = ?');
    values.push(input.workItemId);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = getSqliteDatabase()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM task_outcomes ${where} ORDER BY started_at DESC LIMIT ?`)
    .all(...values, limit);
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

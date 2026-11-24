/**
 * Personal Agent One-Shot Conditional Follow-Up engine (`personal_attention_threads`, `follow_up_mode = 'one_shot'`).
 * Evaluates a single `TaskWait` at a user-specified `checkAt` and publishes at most one reminder
 * to either Personal chat or Workbench unread alerts — distinct from Home Intelligence Continuing Goals
 * (`src/home-intelligence/follow-ups.ts`, `home_followups`).
 */
import { randomUUID } from 'node:crypto';

import {
  PERSONAL_PROACTIVE_MESSAGE_TYPE,
  PersonalProactiveMessageSchema,
  type PersonalOneShotDestination,
  type PersonalOneShotDisplayState,
  type PersonalOneShotFollowUpDto,
  type PersonalOneShotTerminalReason,
  type PersonalOneShotWorkbenchAlert,
  type StopPersonalOneShotFollowUpResponse,
} from '@xopcai/gateway-contract';

import { getAutomation } from '../../automations/storage/index.js';
import type { Config } from '../../config/schema.js';
import { emitSessionTranscriptUpdate } from '../../session/transcript-events.js';
import { createContextEvidence } from '../../storage/sqlite/context-evidence-repository.js';
import { readCurrentTranscriptId } from '../../storage/sqlite/session-instance-repository.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import type { TaskWait } from '@xopcai/gateway-contract';
import { retireCoveredProactiveItems } from '../../proactive-hub/repository.js';
import { resolveUserContextSessionAccess } from '../../user-context/access-policy.js';
import { createLogger } from '../../utils/logger.js';
import { personalConversationState } from '../conversation-state.js';
import { getPersonalAgentByConversation, resolvePersonalOwnerId } from '../repository.js';
import {
  isExplicitFollowUp,
  isExplicitOneShotFollowUp,
  parseLocalCheckTime,
  parseOneShotDestination,
  requestedCheckTime,
  requestedValidUntilTime,
} from './follow-up-request.js';
import {
  getAttentionSources,
  getProactivitySettings,
  isQuiet,
  sourceFingerprint,
  userText,
  type AttentionThread,
  type Outreach,
} from './repository.js';

const log = createLogger('PersonalOneShotFollowUp');
const DEFAULT_VALID_WINDOW_MS = 24 * 3_600_000;
const MAX_FOLLOW_UP_HORIZON_MS = 30 * 86_400_000;

export class OneShotFollowUpValidationError extends Error {
  constructor(
    public readonly code:
      | 'personal_unavailable'
      | 'access_denied'
      | 'proactivity_disabled'
      | 'scheduler_disabled'
      | 'explicit_request_required'
      | 'task_unavailable'
      | 'wait_unavailable'
      | 'missing_check_time'
      | 'past_check_time'
      | 'invalid_valid_until',
    message: string,
  ) {
    super(message);
    this.name = 'OneShotFollowUpValidationError';
  }
}

export class OneShotFollowUpConflictError extends Error {
  constructor(
    message: string,
    public readonly followUp?: PersonalOneShotFollowUpDto,
  ) {
    super(message);
    this.name = 'OneShotFollowUpConflictError';
  }
}

export function isActionableOneShotWait(
  wait: TaskWait | undefined,
): wait is TaskWait & { kind: 'user_input' | 'approval' } {
  return Boolean(
    wait
    && (wait.kind === 'user_input' || wait.kind === 'approval')
    && wait.condition.type !== 'connection',
  );
}

export function waitSummaryText(wait: TaskWait): string {
  const question = typeof wait.condition.question === 'string' ? wait.condition.question.trim() : '';
  return (question || wait.reason || '').trim().slice(0, 600);
}

export function buildOneShotContractKey(input: {
  taskId: string;
  waitId: string;
  checkAt: number;
  validUntil: number;
  destination: PersonalOneShotDestination;
}): string {
  return `${input.taskId}:${input.waitId}:${input.checkAt}:${input.validUntil}:${input.destination}`;
}

export function oneShotWakeupKey(followUpId: string): string {
  return `follow-up:${followUpId}:check`;
}

function formatLocalTimestamp(ms: number, timezone: string, zh: boolean): string {
  try {
    return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-US', {
      timeZone: timezone,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(ms);
  } catch {
    return new Date(ms).toISOString();
  }
}

function isLikelyChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/u.test(text);
}

export function formatOneShotReminderText(input: {
  taskTitle: string;
  wait: TaskWait;
  validUntil: number;
  timezone: string;
  zh: boolean;
}): string {
  const summary = waitSummaryText(input.wait);
  const untilLabel = formatLocalTimestamp(input.validUntil, input.timezone, input.zh);
  if (input.zh) {
    const actionLabel = input.wait.kind === 'approval' ? '待你审批确认' : '仍需你确认或补充决定';
    return `「${input.taskTitle}」${actionLabel}：${summary}。本次约定跟进在 ${untilLabel} 前有效，可在原事项查看并处理。`;
  }
  const actionLabel = input.wait.kind === 'approval' ? 'still needs your approval' : 'still needs your decision';
  return `"${input.taskTitle}" ${actionLabel}: ${summary}. This follow-up remains valid until ${untilLabel}; open the task to review and respond.`;
}

function computeDisplayState(
  thread: AttentionThread,
  outreach: Outreach | undefined,
): PersonalOneShotDisplayState {
  if (thread.status === 'active') {
    return outreach?.state === 'ready' ? 'queued_delivery' : 'scheduled';
  }
  switch (thread.terminal_reason) {
    case 'delivered':
      return 'delivered';
    case 'resolved_before_check':
    case 'task_closed':
      return 'resolved_before_check';
    case 'stopped':
      return 'stopped';
    case 'expired':
      return 'expired';
    default:
      return 'ended';
  }
}

function readOutreachForThread(threadId: string): Outreach | undefined {
  return getSqliteDatabase()
    .prepare('SELECT * FROM personal_outreach WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(threadId) as unknown as Outreach | undefined;
}

function readProjectName(projectId: string | null): string | undefined {
  if (!projectId) return undefined;
  const row = getSqliteDatabase()
    .prepare('SELECT name FROM projects WHERE project_id = ? LIMIT 1')
    .get(projectId) as { name?: string } | undefined;
  return row?.name?.trim() || undefined;
}

export function getOneShotFollowUpDto(
  followUpId: string,
  ownerId: string,
  opts?: { canReadTask?: (taskId: string) => boolean },
): PersonalOneShotFollowUpDto | undefined {
  const db = getSqliteDatabase();
  const thread = db
    .prepare("SELECT * FROM personal_attention_threads WHERE id = ? AND owner_id = ? AND follow_up_mode = 'one_shot'")
    .get(followUpId, ownerId) as unknown as AttentionThread | undefined;
  if (!thread || !thread.task_id || !thread.wait_id || !thread.destination || thread.check_at === null || thread.valid_until === null) {
    return undefined;
  }

  const outreach = readOutreachForThread(thread.id);
  const taskReadable = thread.terminal_reason !== 'access_revoked'
    && (opts?.canReadTask ? opts.canReadTask(thread.task_id) : true);
  const task = taskReadable ? new TaskRepository().get(thread.task_id) : undefined;
  const wait = taskReadable && task ? new TaskRunRepository().getWait(thread.wait_id) : undefined;
  const rawSources = taskReadable ? getAttentionSources(thread.id) : [];

  return {
    followUpId: thread.id,
    status: thread.status,
    displayState: computeDisplayState(thread, outreach),
    revision: thread.revision,
    subject: taskReadable ? thread.subject : '',
    summary: taskReadable ? thread.summary : '',
    taskId: thread.task_id,
    ...(task ? { taskTitle: task.title } : {}),
    projectId: thread.project_id,
    ...(taskReadable ? { projectName: readProjectName(thread.project_id) } : {}),
    waitId: thread.wait_id,
    ...(wait && isActionableOneShotWait(wait) ? { waitKind: wait.kind, waitSummary: waitSummaryText(wait) } : {}),
    destination: thread.destination,
    timezone: thread.timezone ?? getProactivitySettings(ownerId).timezone,
    checkAt: thread.check_at,
    validUntil: thread.valid_until,
    lastCheckedAt: thread.last_checked_at,
    lastCheckError: thread.last_check_error,
    terminalReason: thread.terminal_reason,
    conversationId: thread.conversation_id,
    outreach: outreach
      ? {
          outreachId: outreach.id,
          state: outreach.state as 'decided' | 'ready' | 'published' | 'stale' | 'cancelled',
          destination: outreach.destination,
          ...(taskReadable && outreach.text ? { text: outreach.text } : { text: null }),
          publishedAt: outreach.published_at,
          acknowledgedAt: outreach.acknowledged_at,
        }
      : null,
    sourcesAvailable: rawSources.length > 0,
    sources: rawSources.map(({ processingPolicy: _p, version: _v, ...source }) => source),
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
  };
}

export function listTaskOneShotFollowUps(
  taskId: string,
  ownerId = resolvePersonalOwnerId(),
  opts?: { canReadTask?: (taskId: string) => boolean },
): PersonalOneShotFollowUpDto[] {
  const rows = getSqliteDatabase()
    .prepare(`
      SELECT id FROM personal_attention_threads
      WHERE owner_id = ? AND task_id = ? AND follow_up_mode = 'one_shot'
      ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END ASC, updated_at DESC
      LIMIT 5
    `)
    .all(ownerId, taskId) as Array<{ id: string }>;
  return rows
    .map(row => getOneShotFollowUpDto(row.id, ownerId, opts))
    .filter((item): item is PersonalOneShotFollowUpDto => Boolean(item));
}

export function listUnreadWorkbenchFollowUps(ownerId = resolvePersonalOwnerId()): PersonalOneShotWorkbenchAlert[] {
  const rows = getSqliteDatabase()
    .prepare(`
      SELECT
        t.id AS follow_up_id,
        o.id AS outreach_id,
        t.task_id AS task_id,
        t.wait_id AS wait_id,
        t.subject AS subject,
        o.text AS text,
        o.published_at AS published_at
      FROM personal_outreach o
      JOIN personal_attention_threads t ON t.id = o.thread_id
      WHERE t.owner_id = ?
        AND t.follow_up_mode = 'one_shot'
        AND o.destination = 'workbench'
        AND o.state = 'published'
        AND o.acknowledged_at IS NULL
        AND o.published_at IS NOT NULL
      ORDER BY o.published_at DESC
      LIMIT 20
    `)
    .all(ownerId) as Array<{
      follow_up_id: string;
      outreach_id: string;
      task_id: string;
      wait_id: string;
      subject: string;
      text: string | null;
      published_at: number;
    }>;
  const tasks = new TaskRepository();
  return rows.flatMap(row => {
    const task = tasks.get(row.task_id);
    if (!task) return [];
    return [{
      followUpId: row.follow_up_id,
      outreachId: row.outreach_id,
      taskId: row.task_id,
      waitId: row.wait_id,
      title: task.title || row.subject,
      text: row.text ?? row.subject,
      publishedAt: row.published_at,
    }];
  });
}

export function acknowledgeWorkbenchFollowUp(
  ownerId: string,
  outreachId: string,
  now = Date.now(),
): { ok: true; followUpId: string; taskId: string } | null {
  return runSqliteWriteTransaction(db => {
    const row = db
      .prepare(`
        SELECT o.id AS outreach_id, o.acknowledged_at, t.id AS follow_up_id, t.task_id
        FROM personal_outreach o
        JOIN personal_attention_threads t ON t.id = o.thread_id
        WHERE o.id = ?
          AND t.owner_id = ?
          AND t.follow_up_mode = 'one_shot'
          AND o.destination = 'workbench'
          AND o.state = 'published'
      `)
      .get(outreachId, ownerId) as {
        outreach_id: string;
        acknowledged_at: number | null;
        follow_up_id: string;
        task_id: string;
      } | undefined;
    if (!row) return null;
    if (row.acknowledged_at === null) {
      db.prepare('UPDATE personal_outreach SET acknowledged_at = ? WHERE id = ?').run(now, outreachId);
    }
    return { ok: true, followUpId: row.follow_up_id, taskId: row.task_id };
  });
}

export interface CreateOneShotFollowUpInput {
  conversationId: string;
  config: Config;
  entryId: string;
  sessionInputId?: string;
  taskId: string;
  waitId: string;
  subject?: string;
  summary?: string;
  destination?: PersonalOneShotDestination;
  checkAt?: number;
  checkAtLocal?: string;
  validUntil?: number;
  validUntilLocal?: string;
  confirmReplace?: boolean;
  canReadTask?: (taskId: string) => boolean;
  now?: number;
}

export type CreateOneShotFollowUpResult =
  | {
      outcome: 'created' | 'replayed_input' | 'reused_active';
      followUp: PersonalOneShotFollowUpDto;
      validUntilSource: 'user' | 'task_due' | 'default_window';
      scheduleIntervalMs?: number;
    }
  | {
      outcome: 'conflict_existing_active';
      existing: PersonalOneShotFollowUpDto;
    };

export function createOrReuseOneShotFollowUp(input: CreateOneShotFollowUpInput): CreateOneShotFollowUpResult {
  const now = input.now ?? Date.now();
  const personal = getPersonalAgentByConversation(input.conversationId);
  if (!personal || personal.state !== 'ready') {
    throw new OneShotFollowUpValidationError('personal_unavailable', 'Personal Agent is unavailable');
  }
  const access = resolveUserContextSessionAccess(input.config, input.conversationId);
  if (!access.userModel || input.config.userContext.userModel.writePolicy === 'deny') {
    throw new OneShotFollowUpValidationError('access_denied', 'Personal attention is unavailable under the current user context policy');
  }

  const db = getSqliteDatabase();
  // Layer 1 idempotency check first: exact sessionInputId replay returns the original record even after checkAt/terminal state.
  if (input.sessionInputId) {
    const replayRow = db
      .prepare("SELECT id FROM personal_attention_threads WHERE owner_id = ? AND follow_up_mode = 'one_shot' AND session_input_id = ? LIMIT 1")
      .get(personal.ownerId, input.sessionInputId) as { id: string } | undefined;
    if (replayRow) {
      const existing = getOneShotFollowUpDto(replayRow.id, personal.ownerId, { canReadTask: input.canReadTask });
      if (existing) {
        return { outcome: 'replayed_input', followUp: existing, validUntilSource: 'user' };
      }
    }
  }
  const replayBySource = db
    .prepare(`
      SELECT t.id
      FROM personal_attention_sources s
      JOIN personal_attention_threads t ON t.id = s.thread_id
      WHERE s.entry_id = ? AND t.owner_id = ? AND t.follow_up_mode = 'one_shot'
      LIMIT 1
    `)
    .get(input.entryId, personal.ownerId) as { id: string } | undefined;
  if (replayBySource) {
    const existing = getOneShotFollowUpDto(replayBySource.id, personal.ownerId, { canReadTask: input.canReadTask });
    if (existing) {
      return { outcome: 'replayed_input', followUp: existing, validUntilSource: 'user' };
    }
  }

  const settings = getProactivitySettings(personal.ownerId);
  if (settings.mode === 'off') {
    throw new OneShotFollowUpValidationError(
      'proactivity_disabled',
      'Proactive follow-up is currently off. Enable follow_up or balanced mode before scheduling a conditional reminder.',
    );
  }

  const scheduler = getAutomation('system-personal-proactivity');
  if (scheduler && !scheduler.enabled) {
    throw new OneShotFollowUpValidationError(
      'scheduler_disabled',
      'Personal background attention checks are currently disabled in Automations.',
    );
  }
  const scheduleIntervalMs = scheduler?.trigger.kind === 'schedule' && scheduler.trigger.schedule.kind === 'interval'
    ? scheduler.trigger.schedule.everyMs
    : undefined;

  const transcriptId = readCurrentTranscriptId(db, input.conversationId);
  const sourceRow = db
    .prepare(`
      SELECT payload_json, created_at
      FROM transcript_entries
      WHERE entry_id = ? AND transcript_id = ? AND role = 'user'
        AND COALESCE(json_extract(payload_json, '$.metadata.hiddenFromClient'), 0) = 0
    `)
    .get(input.entryId, transcriptId) as { payload_json: string; created_at: number } | undefined;
  if (!sourceRow) {
    throw new OneShotFollowUpValidationError('explicit_request_required', 'An explicit user message in the active conversation is required');
  }
  const sourceText = userText(JSON.parse(sourceRow.payload_json)).trim();
  if (!sourceText) {
    throw new OneShotFollowUpValidationError('explicit_request_required', 'Attention source message is empty');
  }

  const parsedTextCheckAt = requestedCheckTime(sourceText, sourceRow.created_at, settings.timezone);
  const explicit = isExplicitOneShotFollowUp(sourceText)
    || (isExplicitFollowUp(sourceText) && Boolean(parsedTextCheckAt || input.checkAtLocal || input.checkAt));
  if (!explicit) {
    throw new OneShotFollowUpValidationError(
      'explicit_request_required',
      'One-shot follow-up requires an explicit conditional reminder instruction from the user (negations, quotes, and hypotheticals are excluded).',
    );
  }

  if (input.canReadTask && !input.canReadTask(input.taskId)) {
    throw new OneShotFollowUpValidationError('access_denied', 'You do not have permission to inspect this task');
  }
  const task = new TaskRepository().get(input.taskId);
  if (!task || task.phase === 'closed') {
    throw new OneShotFollowUpValidationError('task_unavailable', 'Target task is unavailable or already closed');
  }
  const wait = new TaskRunRepository().getWait(input.waitId);
  if (!wait || wait.taskId !== task.id || !isActionableOneShotWait(wait) || wait.status !== 'active') {
    throw new OneShotFollowUpValidationError(
      'wait_unavailable',
      'Target pending item is not an active user_input or approval wait on this task',
    );
  }

  const checkAt = parsedTextCheckAt
    ?? (input.checkAtLocal ? parseLocalCheckTime(input.checkAtLocal, settings.timezone) : input.checkAt);
  if (checkAt === undefined || !Number.isFinite(checkAt)) {
    throw new OneShotFollowUpValidationError('missing_check_time', 'A specific check time is required');
  }
  if (checkAt <= now) {
    throw new OneShotFollowUpValidationError('past_check_time', 'Check time must be in the future');
  }
  if (checkAt > now + MAX_FOLLOW_UP_HORIZON_MS) {
    throw new OneShotFollowUpValidationError('invalid_valid_until', 'Check time must be within 30 days');
  }

  const parsedTextValidUntil = requestedValidUntilTime(sourceText, checkAt, settings.timezone);
  const explicitInputValidUntil = input.validUntilLocal
    ? parseLocalCheckTime(input.validUntilLocal, settings.timezone)
    : input.validUntil;
  let validUntil: number;
  let validUntilSource: 'user' | 'task_due' | 'default_window';
  if (parsedTextValidUntil !== undefined) {
    validUntil = parsedTextValidUntil;
    validUntilSource = 'user';
  } else if (explicitInputValidUntil !== undefined) {
    validUntil = explicitInputValidUntil;
    validUntilSource = 'user';
  } else if (task.dueAt !== undefined && task.dueAt > checkAt) {
    validUntil = Math.min(task.dueAt, now + MAX_FOLLOW_UP_HORIZON_MS);
    validUntilSource = 'task_due';
  } else {
    validUntil = Math.min(checkAt + DEFAULT_VALID_WINDOW_MS, now + MAX_FOLLOW_UP_HORIZON_MS);
    validUntilSource = 'default_window';
  }
  if (!Number.isFinite(validUntil) || validUntil <= checkAt) {
    throw new OneShotFollowUpValidationError('invalid_valid_until', 'Valid-until deadline must be later than the check time');
  }

  const destination: PersonalOneShotDestination = parseOneShotDestination(sourceText)
    ?? input.destination
    ?? 'personal';
  const contractKey = buildOneShotContractKey({
    taskId: task.id,
    waitId: wait.id,
    checkAt,
    validUntil,
    destination,
  });
  const subject = (input.subject?.trim() || task.title || waitSummaryText(wait)).slice(0, 160);
  const summary = (input.summary?.trim() || waitSummaryText(wait) || subject).slice(0, 1600);
  const observedAt = Math.min(now, sourceRow.created_at);

  return runSqliteWriteTransaction(txDb => {
    if (input.sessionInputId) {
      const existingByInput = txDb
        .prepare("SELECT id FROM personal_attention_threads WHERE owner_id = ? AND follow_up_mode = 'one_shot' AND session_input_id = ? LIMIT 1")
        .get(personal.ownerId, input.sessionInputId) as { id: string } | undefined;
      if (existingByInput) {
        return {
          outcome: 'replayed_input' as const,
          followUp: getOneShotFollowUpDto(existingByInput.id, personal.ownerId, { canReadTask: input.canReadTask })!,
          validUntilSource,
          ...(scheduleIntervalMs && scheduleIntervalMs > 300_000 ? { scheduleIntervalMs } : {}),
        };
      }
    }

    const existingEquivalent = txDb
      .prepare(`
        SELECT id FROM personal_attention_threads
        WHERE owner_id = ? AND follow_up_mode = 'one_shot' AND status = 'active' AND contract_key = ?
        LIMIT 1
      `)
      .get(personal.ownerId, contractKey) as { id: string } | undefined;
    if (existingEquivalent) {
      const evidence = createContextEvidence({
        sourceType: 'conversation',
        sourceRef: `personal-attention:${input.entryId}`,
        conversationId: input.conversationId,
        messageId: input.entryId,
        trustLevel: 'owner',
        observedAt,
      });
      txDb.prepare(
        'INSERT OR IGNORE INTO personal_attention_sources(thread_id,evidence_id,entry_id,transcript_id,conversation_id) VALUES (?,?,?,?,?)',
      ).run(existingEquivalent.id, evidence.id, input.entryId, transcriptId, input.conversationId);
      txDb.prepare('UPDATE personal_attention_threads SET last_meaningful_at = ?, updated_at = ? WHERE id = ?')
        .run(observedAt, now, existingEquivalent.id);
      return {
        outcome: 'reused_active' as const,
        followUp: getOneShotFollowUpDto(existingEquivalent.id, personal.ownerId, { canReadTask: input.canReadTask })!,
        validUntilSource,
        ...(scheduleIntervalMs && scheduleIntervalMs > 300_000 ? { scheduleIntervalMs } : {}),
      };
    }

    const existingSameWait = txDb
      .prepare(`
        SELECT id, revision FROM personal_attention_threads
        WHERE owner_id = ? AND follow_up_mode = 'one_shot' AND status = 'active' AND task_id = ? AND wait_id = ?
        LIMIT 1
      `)
      .get(personal.ownerId, task.id, wait.id) as { id: string; revision: number } | undefined;
    if (existingSameWait) {
      if (!input.confirmReplace) {
        return {
          outcome: 'conflict_existing_active' as const,
          existing: getOneShotFollowUpDto(existingSameWait.id, personal.ownerId, { canReadTask: input.canReadTask })!,
        };
      }
      txDb.prepare(`
        UPDATE personal_attention_threads
        SET status = 'completed', terminal_reason = 'stopped', next_check_at = NULL, revision = revision + 1, updated_at = ?
        WHERE id = ?
      `).run(now, existingSameWait.id);
      txDb.prepare("UPDATE personal_wakeups SET status = 'cancelled', lease_token = NULL, lease_until = 0 WHERE thread_id = ? AND status IN ('pending','evaluating')")
        .run(existingSameWait.id);
      txDb.prepare("UPDATE personal_outreach SET state = 'cancelled', text = NULL WHERE thread_id = ? AND state = 'ready'")
        .run(existingSameWait.id);
    }

    const followUpId = randomUUID();
    txDb.prepare(`
      INSERT INTO personal_attention_threads(
        id, owner_id, agent_id, conversation_id, subject, summary, kind, status, authority,
        task_id, project_id, next_check_at, expires_at, last_meaningful_at, created_at, updated_at,
        follow_up_mode, wait_id, destination, check_at, valid_until, timezone, contract_key, session_input_id
      ) VALUES (?,?,?,?,?,?,'outcome','active','user_explicit',?,?,?,?,?,?,?,'one_shot',?,?,?,?,?,?,?)
    `).run(
      followUpId,
      personal.ownerId,
      personal.agentId,
      input.conversationId,
      subject,
      summary,
      task.id,
      task.projectId ?? null,
      checkAt,
      validUntil,
      observedAt,
      now,
      now,
      wait.id,
      destination,
      checkAt,
      validUntil,
      settings.timezone,
      contractKey,
      input.sessionInputId ?? null,
    );

    const evidence = createContextEvidence({
      sourceType: 'conversation',
      sourceRef: `personal-attention:${input.entryId}`,
      conversationId: input.conversationId,
      messageId: input.entryId,
      trustLevel: 'owner',
      observedAt,
    });
    txDb.prepare(
      'INSERT OR IGNORE INTO personal_attention_sources(thread_id,evidence_id,entry_id,transcript_id,conversation_id) VALUES (?,?,?,?,?)',
    ).run(followUpId, evidence.id, input.entryId, transcriptId, input.conversationId);

    txDb.prepare(`
      INSERT INTO personal_wakeups(
        id, thread_id, dedupe_key, trigger_kind, source_event_id, thread_revision, not_before, expires_at, status, created_at
      ) VALUES (?, ?, ?, 'one_shot_check', NULL, 1, ?, ?, 'pending', ?)
    `).run(randomUUID(), followUpId, oneShotWakeupKey(followUpId), checkAt, validUntil, now);

    retireCoveredProactiveItems(personal.ownerId, task.id, wait.id, now);

    log.info(
      { followUpId, taskId: task.id, waitId: wait.id, destination, checkAt, validUntil },
      'Created personal one-shot follow-up',
    );

    return {
      outcome: 'created' as const,
      followUp: getOneShotFollowUpDto(followUpId, personal.ownerId, { canReadTask: input.canReadTask })!,
      validUntilSource,
      ...(scheduleIntervalMs && scheduleIntervalMs > 300_000 ? { scheduleIntervalMs } : {}),
    };
  });
}

export function stopOneShotFollowUp(
  input: {
    ownerId: string;
    followUpId: string;
    expectedRevision?: number;
    idempotencyKey: string;
    sourceEntryId?: string;
    canReadTask?: (taskId: string) => boolean;
  },
  now = Date.now(),
): StopPersonalOneShotFollowUpResponse {
  return runSqliteWriteTransaction(db => {
    const dedupeKey = `one-shot-stop:${input.idempotencyKey}`;
    const operationJson = JSON.stringify({
      followUpId: input.followUpId,
      expectedRevision: input.expectedRevision ?? null,
    });
    const priorOp = db
      .prepare('SELECT thread_id, input_json FROM personal_strategy_versions WHERE owner_id = ? AND dedupe_key = ?')
      .get(input.ownerId, dedupeKey) as { thread_id: string; input_json: string } | undefined;
    if (priorOp) {
      if (priorOp.thread_id !== input.followUpId || priorOp.input_json !== operationJson) {
        throw new OneShotFollowUpConflictError('Stop idempotency key was already used for another operation');
      }
      const existing = getOneShotFollowUpDto(input.followUpId, input.ownerId, { canReadTask: input.canReadTask });
      if (!existing) throw new OneShotFollowUpConflictError('Follow-up is unavailable');
      return {
        outcome: existing.terminalReason === 'delivered'
          ? 'already_delivered'
          : existing.terminalReason === 'stopped'
            ? 'stopped'
            : 'already_ended',
        followUp: existing,
      };
    }

    const thread = db
      .prepare("SELECT * FROM personal_attention_threads WHERE id = ? AND owner_id = ? AND follow_up_mode = 'one_shot'")
      .get(input.followUpId, input.ownerId) as unknown as AttentionThread | undefined;
    if (!thread) {
      throw new OneShotFollowUpConflictError('Follow-up is unavailable');
    }

    if (thread.status !== 'active') {
      const currentDto = getOneShotFollowUpDto(thread.id, input.ownerId, { canReadTask: input.canReadTask })!;
      return {
        outcome: thread.terminal_reason === 'delivered'
          ? 'already_delivered'
          : thread.terminal_reason === 'stopped'
            ? 'stopped'
            : 'already_ended',
        followUp: currentDto,
      };
    }

    if (input.expectedRevision !== undefined && thread.revision !== input.expectedRevision) {
      const currentDto = getOneShotFollowUpDto(thread.id, input.ownerId, { canReadTask: input.canReadTask })!;
      throw new OneShotFollowUpConflictError('Follow-up changed; reload before stopping', currentDto);
    }

    const beforeJson = JSON.stringify({ status: thread.status, nextCheckAt: thread.next_check_at, revision: thread.revision });
    const nextRevision = thread.revision + 1;
    db.prepare(`
      UPDATE personal_attention_threads
      SET status = 'completed',
          terminal_reason = 'stopped',
          next_check_at = NULL,
          revision = ?,
          updated_at = ?
      WHERE id = ?
    `).run(nextRevision, now, thread.id);

    db.prepare(`
      UPDATE personal_wakeups
      SET status = 'cancelled', lease_token = NULL, lease_until = 0
      WHERE thread_id = ? AND status IN ('pending', 'evaluating')
    `).run(thread.id);

    db.prepare(`
      UPDATE personal_outreach
      SET state = 'cancelled', text = NULL
      WHERE thread_id = ? AND state = 'ready'
    `).run(thread.id);

    const afterJson = JSON.stringify({ status: 'completed', nextCheckAt: null, revision: nextRevision });
    db.prepare(`
      INSERT INTO personal_strategy_versions(
        id, owner_id, thread_id, revision, kind, before_json, after_json, input_json, source_entry_id, feedback_id, dedupe_key, created_at
      ) VALUES (?, ?, ?, ?, 'stop', ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      randomUUID(),
      input.ownerId,
      thread.id,
      nextRevision,
      beforeJson,
      afterJson,
      operationJson,
      input.sourceEntryId ?? null,
      dedupeKey,
      now,
    );

    const updated = getOneShotFollowUpDto(thread.id, input.ownerId, { canReadTask: input.canReadTask })!;
    log.info({ followUpId: thread.id, taskId: thread.task_id, revision: updated.revision }, 'Stopped personal one-shot follow-up');
    return { outcome: 'stopped', followUp: updated };
  });
}

export interface OneShotStateChange {
  followUpId: string;
  taskId: string;
  conversationId: string;
  outreachId?: string;
  destination?: PersonalOneShotDestination;
  terminalReason?: PersonalOneShotTerminalReason | null;
}

export function reconcileOneShotForTaskEvent(
  taskId: string,
  eventType: string,
  now = Date.now(),
): OneShotStateChange[] {
  return runSqliteWriteTransaction(db => {
    const threads = db
      .prepare("SELECT * FROM personal_attention_threads WHERE follow_up_mode = 'one_shot' AND status = 'active' AND task_id = ?")
      .all(taskId) as unknown as AttentionThread[];
    if (!threads.length) return [];

    const tasks = new TaskRepository();
    const runs = new TaskRunRepository();
    const changes: OneShotStateChange[] = [];

    for (const thread of threads) {
      if (eventType.includes('deleted')) {
        db.prepare(`
          UPDATE personal_attention_threads
          SET status = 'expired', terminal_reason = 'task_deleted', next_check_at = NULL, revision = revision + 1, updated_at = ?
          WHERE id = ?
        `).run(now, thread.id);
        db.prepare("UPDATE personal_wakeups SET status = 'cancelled', lease_token = NULL, lease_until = 0 WHERE thread_id = ? AND status IN ('pending','evaluating')")
          .run(thread.id);
        db.prepare("UPDATE personal_outreach SET state = 'cancelled', text = NULL WHERE thread_id = ? AND state = 'ready'")
          .run(thread.id);
        changes.push({
          followUpId: thread.id,
          taskId,
          conversationId: thread.conversation_id,
          terminalReason: 'task_deleted',
        });
        continue;
      }

      const task = tasks.get(taskId);
      const wait = thread.wait_id ? runs.getWait(thread.wait_id) : undefined;
      if (!task) {
        db.prepare(`
          UPDATE personal_attention_threads
          SET status = 'expired', terminal_reason = 'task_deleted', next_check_at = NULL, revision = revision + 1, updated_at = ?
          WHERE id = ?
        `).run(now, thread.id);
        db.prepare("UPDATE personal_wakeups SET status = 'cancelled', lease_token = NULL, lease_until = 0 WHERE thread_id = ? AND status IN ('pending','evaluating')")
          .run(thread.id);
        db.prepare("UPDATE personal_outreach SET state = 'cancelled', text = NULL WHERE thread_id = ? AND state = 'ready'")
          .run(thread.id);
        changes.push({ followUpId: thread.id, taskId, conversationId: thread.conversation_id, terminalReason: 'task_deleted' });
        continue;
      }

      if (!wait || wait.status !== 'active' || task.phase === 'closed') {
        const reason: PersonalOneShotTerminalReason = !wait || wait.status !== 'active' ? 'resolved_before_check' : 'task_closed';
        db.prepare(`
          UPDATE personal_attention_threads
          SET status = 'completed', terminal_reason = ?, last_checked_at = ?, last_check_error = NULL, next_check_at = NULL, revision = revision + 1, updated_at = ?
          WHERE id = ?
        `).run(reason, now, now, thread.id);
        db.prepare("UPDATE personal_wakeups SET status = 'cancelled', lease_token = NULL, lease_until = 0 WHERE thread_id = ? AND status IN ('pending','evaluating')")
          .run(thread.id);
        db.prepare("UPDATE personal_outreach SET state = 'cancelled', text = NULL WHERE thread_id = ? AND state = 'ready'")
          .run(thread.id);
        changes.push({ followUpId: thread.id, taskId, conversationId: thread.conversation_id, terminalReason: reason });
      }
    }

    return changes;
  });
}

function hasOneShotReadAccess(config: Config, conversationId: string): boolean {
  const personal = getPersonalAgentByConversation(conversationId);
  if (!personal || personal.state !== 'ready') return false;
  const access = resolveUserContextSessionAccess(config, conversationId);
  return access.userModel && config.userContext.userModel.writePolicy !== 'deny';
}

/**
 * Pure-SQLite deterministic evaluation for due one-shot follow-ups.
 * Runs even during foreground busy, quiet hours, or local_only processing policy.
 */
export function evaluateOneShotWakeups(
  now: number,
  deps: { getConfig: () => Config; canReadTask?: (taskId: string, ownerId: string) => boolean },
): OneShotStateChange[] {
  return runSqliteWriteTransaction(db => {
    const changes: OneShotStateChange[] = [];

    // 1. Settle overdue active one-shot threads whose valid_until has already passed.
    const expiredThreads = db
      .prepare(`
        SELECT * FROM personal_attention_threads
        WHERE follow_up_mode = 'one_shot' AND status = 'active' AND valid_until <= ?
      `)
      .all(now) as unknown as AttentionThread[];
    for (const thread of expiredThreads) {
      db.prepare(`
        UPDATE personal_attention_threads
        SET status = 'expired', terminal_reason = 'expired', next_check_at = NULL, revision = revision + 1, updated_at = ?
        WHERE id = ?
      `).run(now, thread.id);
      db.prepare("UPDATE personal_wakeups SET status = 'cancelled', lease_token = NULL, lease_until = 0 WHERE thread_id = ? AND status IN ('pending','evaluating')")
        .run(thread.id);
      db.prepare("UPDATE personal_outreach SET state = 'stale', text = NULL WHERE thread_id = ? AND state = 'ready'")
        .run(thread.id);
      if (thread.task_id) {
        changes.push({
          followUpId: thread.id,
          taskId: thread.task_id,
          conversationId: thread.conversation_id,
          terminalReason: 'expired',
        });
      }
    }

    // 2. Evaluate all due one-shot wakeups within their valid_until window.
    const dueWakeups = db
      .prepare(`
        SELECT w.id AS wakeup_id, w.thread_id, w.thread_revision
        FROM personal_wakeups w
        JOIN personal_attention_threads t ON t.id = w.thread_id
        WHERE t.follow_up_mode = 'one_shot'
          AND w.status IN ('pending', 'evaluating')
          AND w.lease_until <= ?
          AND w.next_attempt_at <= ?
          AND w.not_before <= ?
          AND w.expires_at > ?
        ORDER BY w.not_before ASC
        LIMIT 50
      `)
      .all(now, now, now, now) as Array<{ wakeup_id: string; thread_id: string; thread_revision: number }>;

    if (!dueWakeups.length) return changes;

    const config = deps.getConfig();
    const tasks = new TaskRepository();
    const runs = new TaskRunRepository();

    for (const item of dueWakeups) {
      const thread = db
        .prepare('SELECT * FROM personal_attention_threads WHERE id = ?')
        .get(item.thread_id) as unknown as AttentionThread | undefined;
      if (!thread || thread.status !== 'active' || thread.revision !== item.thread_revision || !thread.task_id || !thread.wait_id) {
        db.prepare("UPDATE personal_wakeups SET status = 'cancelled', lease_token = NULL, lease_until = 0 WHERE id = ?")
          .run(item.wakeup_id);
        continue;
      }

      const canRead = hasOneShotReadAccess(config, thread.conversation_id)
        && (deps.canReadTask ? deps.canReadTask(thread.task_id, thread.owner_id) : true);
      if (!canRead) {
        db.prepare(`
          UPDATE personal_attention_threads
          SET status = 'expired', terminal_reason = 'access_revoked', next_check_at = NULL, revision = revision + 1, updated_at = ?
          WHERE id = ?
        `).run(now, thread.id);
        db.prepare("UPDATE personal_wakeups SET status = 'cancelled', lease_token = NULL, lease_until = 0 WHERE id = ?")
          .run(item.wakeup_id);
        db.prepare("UPDATE personal_outreach SET state = 'cancelled', text = NULL WHERE thread_id = ? AND state = 'ready'")
          .run(thread.id);
        changes.push({ followUpId: thread.id, taskId: thread.task_id, conversationId: thread.conversation_id, terminalReason: 'access_revoked' });
        continue;
      }

      const transcriptId = readCurrentTranscriptId(db, thread.conversation_id);
      const sources = getAttentionSources(thread.id);
      if (!transcriptId || !sources.length) {
        db.prepare(`
          UPDATE personal_attention_threads
          SET status = 'expired', terminal_reason = 'conversation_reset', next_check_at = NULL, revision = revision + 1, updated_at = ?
          WHERE id = ?
        `).run(now, thread.id);
        db.prepare("UPDATE personal_wakeups SET status = 'cancelled', lease_token = NULL, lease_until = 0 WHERE id = ?")
          .run(item.wakeup_id);
        changes.push({ followUpId: thread.id, taskId: thread.task_id, conversationId: thread.conversation_id, terminalReason: 'conversation_reset' });
        continue;
      }

      const task = tasks.get(thread.task_id);
      if (!task) {
        db.prepare(`
          UPDATE personal_attention_threads
          SET status = 'expired', terminal_reason = 'task_deleted', last_checked_at = ?, next_check_at = NULL, revision = revision + 1, updated_at = ?
          WHERE id = ?
        `).run(now, now, thread.id);
        db.prepare("UPDATE personal_wakeups SET status = 'cancelled', lease_token = NULL, lease_until = 0 WHERE id = ?")
          .run(item.wakeup_id);
        changes.push({ followUpId: thread.id, taskId: thread.task_id, conversationId: thread.conversation_id, terminalReason: 'task_deleted' });
        continue;
      }

      const wait = runs.getWait(thread.wait_id);
      if (!wait || wait.status !== 'active' || task.phase === 'closed') {
        const reason: PersonalOneShotTerminalReason = !wait || wait.status !== 'active' ? 'resolved_before_check' : 'task_closed';
        db.prepare(`
          UPDATE personal_attention_threads
          SET status = 'completed', terminal_reason = ?, last_checked_at = ?, last_check_error = NULL, next_check_at = NULL, revision = revision + 1, updated_at = ?
          WHERE id = ?
        `).run(reason, now, now, thread.id);
        db.prepare("UPDATE personal_wakeups SET status = 'done', lease_token = NULL, lease_until = 0 WHERE id = ?")
          .run(item.wakeup_id);
        changes.push({ followUpId: thread.id, taskId: thread.task_id, conversationId: thread.conversation_id, terminalReason: reason });
        continue;
      }

      // Condition matched: queue at most 1 ready outreach row for this wakeup.
      const existingOutreach = db
        .prepare('SELECT id FROM personal_outreach WHERE wakeup_id = ? LIMIT 1')
        .get(item.wakeup_id) as { id: string } | undefined;
      const outreachId = existingOutreach?.id ?? randomUUID();
      if (!existingOutreach) {
        const settings = getProactivitySettings(thread.owner_id);
        const context = personalConversationState(thread.conversation_id);
        const zh = isLikelyChinese(`${sources[0]?.excerpt ?? ''} ${task.title} ${wait.reason}`);
        const text = formatOneShotReminderText({
          taskTitle: task.title,
          wait,
          validUntil: thread.valid_until ?? thread.expires_at,
          timezone: thread.timezone ?? settings.timezone,
          zh,
        });
        const display = {
          outreachId,
          reasonKind: 'follow_up' as const,
          authority: 'user_explicit' as const,
        };
        const destination: PersonalOneShotDestination = thread.destination ?? 'personal';
        db.prepare(`
          INSERT INTO personal_outreach(
            id, wakeup_id, thread_id, conversation_id, origin_transcript_id, thread_revision,
            context_revision, policy_revision, decision, reason, state, text, provenance_json,
            valid_until, created_at, destination
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'contact', ?, 'ready', ?, ?, ?, ?, ?)
        `).run(
          outreachId,
          item.wakeup_id,
          thread.id,
          thread.conversation_id,
          transcriptId,
          thread.revision,
          context.revision,
          settings.revision,
          zh ? '到约定检查时刻，原任务待决项仍未处理' : 'The pending item remained unresolved at the scheduled check time',
          text,
          JSON.stringify({
            display,
            fingerprint: sourceFingerprint(sources),
            sourceIds: sources.map(source => source.entryId),
            taskId: task.id,
            waitId: wait.id,
          }),
          thread.valid_until ?? thread.expires_at,
          now,
          destination,
        );
      }
      db.prepare(`
        UPDATE personal_attention_threads
        SET last_checked_at = ?, last_check_error = NULL, next_check_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, now, thread.id);
      db.prepare("UPDATE personal_wakeups SET status = 'done', lease_token = NULL, lease_until = 0 WHERE id = ?")
        .run(item.wakeup_id);

      changes.push({
        followUpId: thread.id,
        taskId: thread.task_id,
        conversationId: thread.conversation_id,
        outreachId,
        destination: thread.destination ?? 'personal',
      });
    }

    return changes;
  });
}

/**
 * Single authoritative publication gate for one-shot follow-ups.
 * Decoupled from context_revision / policy_revision invalidation so recovery from DND or busy chat never drops the queued reminder.
 */
export function publishOneShotOutreach(
  now: number,
  deps: {
    getConfig: () => Config;
    isConversationAvailable: (conversationId: string) => boolean;
    notifyPersonalTranscript: (conversationId: string, outreachId: string) => void;
    onFollowUpUpdated?: (change: OneShotStateChange) => void;
    onBeforePublishDestination?: (info: { ownerId: string; taskId: string; waitId: string; followUpId: string; outreachId: string; now: number }) => void;
    canReadTask?: (taskId: string, ownerId: string) => boolean;
  },
): OneShotStateChange[] {
  const db = getSqliteDatabase();
  const candidates = db
    .prepare(`
      SELECT o.*
      FROM personal_outreach o
      JOIN personal_attention_threads t ON t.id = o.thread_id
      WHERE t.follow_up_mode = 'one_shot'
        AND (o.state = 'ready' OR (o.state = 'published' AND o.notified_at IS NULL))
      ORDER BY o.created_at ASC
      LIMIT 30
    `)
    .all() as unknown as Outreach[];

  const changes: OneShotStateChange[] = [];
  if (!candidates.length) return changes;

  const config = deps.getConfig();
  const tasks = new TaskRepository();
  const runs = new TaskRunRepository();

  for (const row of candidates) {
    const txOutcome = runSqliteWriteTransaction(txDb => {
      const current = txDb
        .prepare('SELECT * FROM personal_outreach WHERE id = ?')
        .get(row.id) as unknown as Outreach | undefined;
      if (!current) return { kind: 'noop' as const };
      const thread = txDb
        .prepare('SELECT * FROM personal_attention_threads WHERE id = ?')
        .get(current.thread_id) as unknown as AttentionThread | undefined;
      if (!thread || thread.follow_up_mode !== 'one_shot' || !thread.task_id || !thread.wait_id) {
        return { kind: 'noop' as const };
      }

      if (current.state === 'published') {
        return {
          kind: 'published' as const,
          followUpId: thread.id,
          taskId: thread.task_id,
          conversationId: current.conversation_id,
          outreachId: current.id,
          destination: current.destination,
        };
      }
      if (current.state !== 'ready') {
        return { kind: 'noop' as const };
      }

      // Stopped or superseded before publish
      if (thread.status !== 'active' || thread.revision !== current.thread_revision) {
        txDb.prepare("UPDATE personal_outreach SET state = 'cancelled', text = NULL WHERE id = ?").run(current.id);
        return { kind: 'noop' as const };
      }

      // Window expired while queued
      const validUntil = Math.min(current.valid_until, thread.valid_until ?? thread.expires_at);
      if (validUntil <= now) {
        txDb.prepare("UPDATE personal_outreach SET state = 'stale', text = NULL WHERE id = ?").run(current.id);
        txDb.prepare(`
          UPDATE personal_attention_threads
          SET status = 'expired', terminal_reason = 'expired', next_check_at = NULL, revision = revision + 1, updated_at = ?
          WHERE id = ?
        `).run(now, thread.id);
        return {
          kind: 'settled' as const,
          change: { followUpId: thread.id, taskId: thread.task_id, conversationId: thread.conversation_id, terminalReason: 'expired' as const },
        };
      }

      // Access check
      const canRead = hasOneShotReadAccess(config, thread.conversation_id)
        && (deps.canReadTask ? deps.canReadTask(thread.task_id, thread.owner_id) : true);
      if (!canRead) {
        txDb.prepare("UPDATE personal_outreach SET state = 'cancelled', text = NULL WHERE id = ?").run(current.id);
        txDb.prepare(`
          UPDATE personal_attention_threads
          SET status = 'expired', terminal_reason = 'access_revoked', next_check_at = NULL, revision = revision + 1, updated_at = ?
          WHERE id = ?
        `).run(now, thread.id);
        return {
          kind: 'settled' as const,
          change: { followUpId: thread.id, taskId: thread.task_id, conversationId: thread.conversation_id, terminalReason: 'access_revoked' as const },
        };
      }

      // Re-verify Task and TaskWait inside the publish write transaction
      const task = tasks.get(thread.task_id);
      if (!task) {
        txDb.prepare("UPDATE personal_outreach SET state = 'cancelled', text = NULL WHERE id = ?").run(current.id);
        txDb.prepare(`
          UPDATE personal_attention_threads
          SET status = 'expired', terminal_reason = 'task_deleted', next_check_at = NULL, revision = revision + 1, updated_at = ?
          WHERE id = ?
        `).run(now, thread.id);
        return {
          kind: 'settled' as const,
          change: { followUpId: thread.id, taskId: thread.task_id, conversationId: thread.conversation_id, terminalReason: 'task_deleted' as const },
        };
      }

      const wait = runs.getWait(thread.wait_id);
      if (!wait || wait.status !== 'active' || task.phase === 'closed') {
        const reason: PersonalOneShotTerminalReason = !wait || wait.status !== 'active' ? 'resolved_before_check' : 'task_closed';
        txDb.prepare("UPDATE personal_outreach SET state = 'cancelled', text = NULL WHERE id = ?").run(current.id);
        txDb.prepare(`
          UPDATE personal_attention_threads
          SET status = 'completed', terminal_reason = ?, last_checked_at = ?, next_check_at = NULL, revision = revision + 1, updated_at = ?
          WHERE id = ?
        `).run(reason, now, now, thread.id);
        return {
          kind: 'settled' as const,
          change: { followUpId: thread.id, taskId: thread.task_id, conversationId: thread.conversation_id, terminalReason: reason },
        };
      }

      // Check current delivery timing gates (retain state='ready' if deferred)
      const settings = getProactivitySettings(thread.owner_id);
      if (settings.mode === 'off' || isQuiet(now, settings)) {
        return { kind: 'deferred' as const };
      }

      if (current.destination === 'personal') {
        const activeTranscriptId = readCurrentTranscriptId(txDb, current.conversation_id);
        if (activeTranscriptId !== current.origin_transcript_id) {
          txDb.prepare("UPDATE personal_outreach SET state = 'stale', text = NULL WHERE id = ?").run(current.id);
          txDb.prepare(`
            UPDATE personal_attention_threads
            SET status = 'expired', terminal_reason = 'conversation_reset', next_check_at = NULL, revision = revision + 1, updated_at = ?
            WHERE id = ?
          `).run(now, thread.id);
          return {
            kind: 'settled' as const,
            change: { followUpId: thread.id, taskId: thread.task_id, conversationId: thread.conversation_id, terminalReason: 'conversation_reset' as const },
          };
        }
        const convState = personalConversationState(current.conversation_id);
        if (!convState.idle || !deps.isConversationAvailable(current.conversation_id)) {
          return { kind: 'deferred' as const };
        }
      }

      // Retire any stale Proactive Hub candidates targeting the same (ownerId, taskId, waitId) before publishing
      deps.onBeforePublishDestination?.({
        ownerId: thread.owner_id,
        taskId: thread.task_id,
        waitId: thread.wait_id,
        followUpId: thread.id,
        outreachId: current.id,
        now,
      });

      const provenance = JSON.parse(current.provenance_json) as {
        display: { outreachId: string; reasonKind: 'follow_up'; authority: 'user_explicit' };
      };
      let messageEntryId: string | null = null;
      if (current.destination === 'personal') {
        const message = PersonalProactiveMessageSchema.parse({
          version: 1,
          outreachId: current.id,
          threadId: thread.id,
          conversationId: current.conversation_id,
          originTranscriptId: current.origin_transcript_id,
          text: current.text ?? task.title,
          provenance: provenance.display,
          createdAt: now,
        });
        const entry = appendTranscriptEntry(
          current.conversation_id,
          {
            role: 'custom',
            customType: PERSONAL_PROACTIVE_MESSAGE_TYPE,
            content: message.text,
            details: message,
            display: true,
            timestamp: now,
          },
          {
            transcriptId: current.origin_transcript_id,
            entryId: `one-shot-outreach:${current.id}`,
          },
        );
        messageEntryId = entry.entry_id;
      }

      txDb.prepare(`
        UPDATE personal_outreach
        SET state = 'published', message_entry_id = ?, published_at = ?
        WHERE id = ?
      `).run(messageEntryId, now, current.id);

      txDb.prepare(`
        UPDATE personal_attention_threads
        SET status = 'completed',
            terminal_reason = 'delivered',
            last_checked_at = ?,
            next_check_at = NULL,
            revision = revision + 1,
            updated_at = ?
        WHERE id = ?
      `).run(now, now, thread.id);

      log.info(
        { followUpId: thread.id, outreachId: current.id, taskId: thread.task_id, destination: current.destination },
        'Published personal one-shot follow-up reminder',
      );

      return {
        kind: 'published' as const,
        followUpId: thread.id,
        taskId: thread.task_id,
        conversationId: current.conversation_id,
        outreachId: current.id,
        destination: current.destination,
      };
    });

    if (txOutcome.kind === 'settled') {
      changes.push(txOutcome.change);
      deps.onFollowUpUpdated?.(txOutcome.change);
      continue;
    }

    if (txOutcome.kind === 'published') {
      const change: OneShotStateChange = {
        followUpId: txOutcome.followUpId,
        taskId: txOutcome.taskId,
        conversationId: txOutcome.conversationId,
        outreachId: txOutcome.outreachId,
        destination: txOutcome.destination,
        terminalReason: 'delivered',
      };
      changes.push(change);
      try {
        if (txOutcome.destination === 'personal') {
          emitSessionTranscriptUpdate({ conversationId: txOutcome.conversationId });
          deps.notifyPersonalTranscript(txOutcome.conversationId, txOutcome.outreachId);
        }
        deps.onFollowUpUpdated?.(change);
        db.prepare('UPDATE personal_outreach SET notified_at = ? WHERE id = ?').run(now, txOutcome.outreachId);
      } catch (err) {
        log.warn({ err, outreachId: txOutcome.outreachId, phase: 'one_shot_notify' }, 'Published one-shot follow-up broadcast will retry');
      }
    }
  }

  return changes;
}

/**
 * Returns true if an explicit one-shot follow-up governs (ownerId, taskId, waitId) —
 * including active, delivered, stopped, expired, or resolved_before_check records for that exact waitId —
 * so Proactive Hub / duplicate notifications never re-emit the same pending item as a generic alert.
 */
export function hasCoveringOneShotFollowUp(
  ownerId: string,
  taskId: string,
  waitId?: string,
): boolean {
  if (!taskId) return false;
  const db = getSqliteDatabase();
  if (waitId) {
    const exact = db
      .prepare(`
        SELECT 1 FROM personal_attention_threads
        WHERE owner_id = ? AND follow_up_mode = 'one_shot' AND task_id = ? AND wait_id = ?
          AND (status = 'active' OR terminal_reason IN ('delivered', 'stopped', 'expired', 'resolved_before_check', 'task_closed'))
        LIMIT 1
      `)
      .get(ownerId, taskId, waitId);
    return Boolean(exact);
  }
  // When an event only carries taskId without waitId, check if the task has a single active actionable wait governed by a one-shot follow-up.
  const activeWaits = new TaskRunRepository().listActiveWaits(taskId).filter(isActionableOneShotWait);
  if (activeWaits.length === 1) {
    const singleWaitId = activeWaits[0]!.id;
    const matched = db
      .prepare(`
        SELECT 1 FROM personal_attention_threads
        WHERE owner_id = ? AND follow_up_mode = 'one_shot' AND task_id = ? AND wait_id = ?
          AND (status = 'active' OR terminal_reason IN ('delivered', 'stopped', 'expired', 'resolved_before_check', 'task_closed'))
        LIMIT 1
      `)
      .get(ownerId, taskId, singleWaitId);
    return Boolean(matched);
  }
  return false;
}

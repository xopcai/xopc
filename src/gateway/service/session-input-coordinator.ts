import type { SessionInputControlCommand } from '@xopcai/gateway-contract';
import crypto from 'node:crypto';
import { consumePhoneAssistance, finishPhoneAssistance, phoneAssistance, queuePhoneAssistance, reconcilePhoneAssistance, type PhoneAssistance } from '../../phone/assistance.js';
import { isDeepStrictEqual } from 'node:util';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';
import type { ConnectionWait } from '@xopcai/gateway-contract';

import { acceptSessionInputControl, hasSessionInputControlOperation, readSessionInputControl, SessionInputControlConflict } from '../../storage/sqlite/session-input-control-repository.js';
import { injectSourceContextsIntoUserMessage } from '../../agent/source-context/injector.js';
import { findSessionInputByRunId, type SessionInput } from '../../storage/sqlite/session-input-repository.js';
import { consumeConnectionResume, publishConnectionWait, getActiveConnectionWait, getConnectionWait, hasPendingConnectionMessages, interruptedConnectionMessage, cancelConnectionObjective, reconcileConnectionWaits } from '../../storage/sqlite/connection-wait-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { emitSessionTranscriptUpdate } from '../../session/transcript-events.js';
import { readCurrentTranscriptId } from '../../storage/sqlite/session-instance-repository.js';
import {
  consumeClarificationResume,
  getActiveClarification,
  supersedeActiveClarification,
} from '../../storage/sqlite/clarification-wait-repository.js';
import { SessionInstanceChangedError } from '../../storage/sqlite/session-input-repository.js';
import type { UserTurnAttachment } from '../user-turn-input.js';
import {
  summarizeSourceContext,
  type AgentSourceContext,
  type TurnContextRef,
} from '../../agent/source-context/types.js';
import {
  cancelQueuedSessionInput,
  claimNextSessionInput,
  findSessionInput,
  finishSessionInputRun,
  getSessionInputState,
  getSessionInputById,
  insertSessionInput,
  mutateQueuedSessionInput,
  recoverSessionInputState,
  replaceLatestSessionTurnAndQueueInput,
  setSessionInputStatus,
  validateLatestSessionTurnTarget,
  type SessionInputDelivery,
  type SessionInputState,
} from '../../storage/sqlite/index.js';
import { deleteMediaUrisNoLongerReferenced } from '../../media/session-references.js';
import { createLogger } from '../../utils/logger.js';
import { fitSourceContextsToBudget } from '../../agent/source-context/budget.js';
import { TaskApplicationService } from '../../tasks/task-application-service.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';

const log = createLogger('SessionInputCoordinator');
const MAX_PENDING_INPUTS = 10;

function connectionControl(input: SubmitSessionInput, wait: ConnectionWait): 'continue' | 'cancel' | undefined {
  if (input.attachments?.length || input.contextRefs?.length || input.sourceContexts?.some(source => source.kind !== 'device_context')
    || (input.origin.type === 'system' && input.origin.source !== 'cli')) return undefined;
  const text = input.content.trim().toLowerCase().replace(/[。.!！?？]+$/u, '').trim();
  if (/^(?:继续|继续看下|继续看看|继续这个目标|继续原目标|continue|resume)$/u.test(text)) {
    if (text !== '继续原目标' && (hasPendingConnectionMessages(wait) || getActiveClarification(wait.conversationId))) return undefined;
    return 'continue';
  }
  if (/^(?:取消这个目标|取消原目标|取消当前目标|cancel this objective|cancel the original objective)$/u.test(text)) return 'cancel';
  return undefined;
}

function connectionInputPayload(wait: ConnectionWait | undefined, control: 'continue' | 'cancel' | undefined): SessionInput['payload'] {
  if (!wait) return undefined;
  if (control) return { waitId: wait.id, objectiveRevision: wait.objectiveRevision, connectionAction: control };
  if (wait.status !== 'closed') return { waitId: wait.id, objectiveRevision: wait.objectiveRevision, connectionBarrier: true };
  return undefined;
}

function sameAppContext(input: SubmitSessionInput, existing: SessionInput): boolean {
  const identity = (sources?: AgentSourceContext[]) => sources?.filter(source => source.kind === 'app_context' || source.kind === 'device_context')
    .map(source => ({ snapshot: source.appContext, principal: source.appContextGrant?.principal.principalId, interactionCapabilities: source.interactionCapabilities })) ?? [];
  return isDeepStrictEqual(input.origin, existing.origin)
    && isDeepStrictEqual(identity(input.sourceContexts), identity(existing.contextSnapshots));
}

function canSteerContexts(state: SessionInputState, origin: TurnOrigin, contexts?: AgentSourceContext[]): boolean {
  if (!contexts?.length) return true;
  const active = state.activeInputId ? getSessionInputById(state.conversationId, state.activeInputId) : undefined;
  return Boolean(active && isDeepStrictEqual(active.origin, origin)
    && contexts.every(context => context.kind === 'device_context'));
}

function steeringText(content: string, contexts?: AgentSourceContext[]): string {
  if (!contexts?.length) return content;
  const message = injectSourceContextsIntoUserMessage({ role: 'user', content, timestamp: Date.now() } as AgentMessage, contexts);
  return (message as { content: Array<{ text: string }> }).content[0]!.text;
}

function contextRefsMatchFrozenSnapshot(
  requested: readonly TurnContextRef[],
  frozen: SessionInputState['inputs'][number]['contextRefs'],
): boolean {
  const editable = frozen?.filter(ref => ref.kind === 'result' || ref.kind === 'note' || ref.kind === 'task'
    || ref.kind === 'file' || ref.kind === 'session' || ref.kind === 'browser_tab'
    || ref.kind === 'user_assertion') ?? [];
  if (requested.length !== editable.length) return false;
  return requested.every((ref, index) => {
    const snapshot = editable[index];
    return snapshot?.kind === ref.kind
      && snapshot.sourceId === ref.sourceId
      && snapshot.refId === ref.refId
      && ref.expectedVersion === snapshot.version;
  });
}

export type SubmitSessionInput = {
  controlVersion?: number;
  expectedTranscriptId?: string;
  conversationId: string;
  clientMessageId: string;
  delivery: SessionInputDelivery;
  /** False explicitly defers a Personal AI message or requests cooperative steering. */
  interrupt?: boolean;
  content: string;
  attachments?: UserTurnAttachment[];
  contextRefs?: TurnContextRef[];
  sourceContexts?: AgentSourceContext[];
  thinking?: string;
  origin: TurnOrigin;
};

export type ReplaceLatestTurnInput = SubmitSessionInput & {
  targetTurnId: string;
};

export class SessionInputCoordinator {
  private readonly pendingSubmissions = new Map<string, number>();
  private readonly resumeAfter = new Map<string, number>();
  private readonly draining = new Set<string>();
  private readonly submissionTails = new Map<string, Promise<void>>();
  private readonly pendingConnectionStops = new Set<string>();

  constructor(private readonly deps: {
    prioritizeInput?: (input: SubmitSessionInput) => boolean;
    interrupt?: (conversationId: string, runId: string, reason?: 'connection_cancel' | 'user_stop') => Promise<void>;
    coalesceWindowMs?: number;
    onInputReceived?: (conversationId: string) => void;
    beforeExecute?: (input: SessionInput) => Promise<boolean>;
    continueConnection?: (wait: ConnectionWait, idempotencyKey: string) => Promise<void>;
    cancelConnection?: (wait: ConnectionWait) => void;
    completePhone?: (wait: PhoneAssistance) => Promise<void>;
    sessionExists: (conversationId: string) => Promise<boolean>;
    execute: (input: {
      inputReceivedAtMs?: number;
      runId: string;
      taskRunId?: string;
      conversationId: string;
      content: string;
      attachments?: UserTurnAttachment[];
      sourceContexts?: AgentSourceContext[];
      thinking?: string;
      origin: TurnOrigin;
    }) => Promise<{ status: string; summary: string }>;
    prepareAttachments: (
      conversationId: string,
      attachments?: UserTurnAttachment[],
    ) => Promise<UserTurnAttachment[] | undefined>;
    prepareContexts: (
      conversationId: string,
      contextRefs?: TurnContextRef[],
    ) => Promise<AgentSourceContext[] | undefined>;
    steer: (conversationId: string, content: string, runId?: string) => Promise<boolean>;
    emit: (type: string, payload: unknown) => void;
  }) {}

  async control(conversationId: string, command: SessionInputControlCommand) {
    if (!await this.deps.sessionExists(conversationId)) throw new SessionInputControlConflict('Conversation not found');
    const replay = hasSessionInputControlOperation(conversationId, command.operationId);
    if (!replay && command.turnId) {
      const target = validateLatestSessionTurnTarget(conversationId, command.turnId);
      if (!target.ok) throw new SessionInputControlConflict('Only the latest user turn can be edited');
    }
    const row = command.inputId ? getSessionInputById(conversationId, command.inputId) : undefined;
    if (!replay && command.action === 'steer' && (!row || row.attachments?.length || row.contextRefs?.length
      || !canSteerContexts(this.snapshot(conversationId), row.origin, row.contextSnapshots))) {
      throw new SessionInputControlConflict('This input cannot steer the active reply');
    }
    const accepted = acceptSessionInputControl(conversationId, command);
    this.publish(conversationId);
    if (command.action === 'steer') {
      if (!accepted.replay && row) {
        try {
          if (!await this.deps.steer(conversationId, steeringText(row.content, row.contextSnapshots), accepted.runId)) {
            setSessionInputStatus(row.id, 'interrupted', { effectiveDelivery: 'next', targetRunId: null, error: 'Current reply ended before steering' });
          }
        } catch (err) {
          log.warn({ err, conversationId, inputId: row.id }, 'Steering delivery is awaiting confirmation');
        }
      }
      return this.publish(conversationId);
    }
    if (accepted.runId) {
      // Keep the durable stop fence if cancellation fails. Retrying the same operation
      // must never capture or cancel a later run.
      await this.deps.interrupt?.(conversationId, accepted.runId, 'user_stop');
    }
    if ((command.action === 'resume' || command.action === 'send') && !accepted.replay) void this.drain(conversationId);
    return this.publish(conversationId);
  }

  isAcceptingInput(conversationId: string): boolean {
    return (this.pendingSubmissions.get(conversationId) ?? 0) > 0;
  }

  snapshot(conversationId: string): SessionInputState {
    return getSessionInputState(conversationId);
  }
  resumePhone(conversationId: string, waitId: string): void {
    queuePhoneAssistance(conversationId, waitId);
    this.publish(conversationId);
    void this.drain(conversationId);
  }

  private connectionTarget(conversationId: string, runtime = this.snapshot(conversationId)): ConnectionWait | undefined {
    const active = runtime.activeInputId ? getSessionInputById(conversationId, runtime.activeInputId) : undefined;
    return getActiveConnectionWait(conversationId)
      ?? (active?.kind === 'connection_resume' && active.payload ? getConnectionWait(active.payload.waitId) : undefined);
  }

  async prepareInput(input: SubmitSessionInput) {
    const attachments = await this.deps.prepareAttachments(input.conversationId, input.attachments);
    const resolved = await this.deps.prepareContexts(input.conversationId, input.contextRefs) ?? [];
    const contexts = fitSourceContextsToBudget([...resolved, ...(input.sourceContexts ?? [])]);
    const wait = this.connectionTarget(input.conversationId);
    const control = wait?.principalId === 'local-owner' ? connectionControl(input, wait) : undefined;
    const payload = connectionInputPayload(wait, control);
    return {
      status: 'queued' as const, requestedDelivery: input.delivery, effectiveDelivery: 'next' as const,
      content: input.content.trim(), attachments, contextRefs: contexts.map(summarizeSourceContext),
      interruptRequested: !wait
        && input.interrupt !== false && this.deps.prioritizeInput?.(input) === true,
      contextSnapshots: contexts, thinking: input.thinking, origin: input.origin,
      ...(payload ? { payload } : {}),
    };
  }

  async dispatchAcceptedInput(conversationId: string, inputId: string): Promise<void> {
    const input = getSessionInputById(conversationId, inputId);
    if (!input) return;
    await this.runSubmissionExclusive(input.conversationId, async () => {
      const row = getSessionInputById(conversationId, inputId);
      const state = this.snapshot(input.conversationId);
      if (!row || row.status !== 'queued' || state.control.paused) return;
      if (row.payload?.connectionAction === 'cancel') this.completeConnectionCancellation(row);
      if (row.payload?.connectionAction || this.connectionTarget(row.conversationId, state)) {
        this.requestConnectionStop(row);
        return;
      }
      if (row.interruptRequested) {
        this.prioritizeAcceptedInput(row, state);
        return;
      }
      if (row.requestedDelivery !== 'steer'
        || !state.activeRunId || row.attachments?.length || !canSteerContexts(state, row.origin, row.contextSnapshots)
        || (state.preparation && state.preparation.state !== 'ready')) return;
      setSessionInputStatus(row.id, 'injecting', { effectiveDelivery: 'steer', targetRunId: state.activeRunId });
      try {
        if (!await this.deps.steer(row.conversationId, steeringText(row.content, row.contextSnapshots), state.activeRunId)) {
          setSessionInputStatus(row.id, 'queued', { effectiveDelivery: 'next', targetRunId: null });
        }
      } catch (error) {
        // An ambiguous injection must not be executed again as a queued turn.
        log.warn({ err: error, conversationId: row.conversationId, inputId }, 'Accepted steering input awaits execution recovery');
      }
      this.publish(row.conversationId);
    });
  }

  private prioritizeAcceptedInput(row: SessionInput, runtime: SessionInputState): void {
    const conversationId = row.conversationId;
    this.resumeAfter.set(conversationId, Date.now() + (this.deps.coalesceWindowMs ?? 200));
    this.publish(conversationId);
    if (runtime.activeRunId && this.deps.interrupt) {
      this.deps.emit('session.input-interrupt', { conversationId, runId: runtime.activeRunId, inputId: row.id });
      // Only interrupt after validation and durable acceptance. Never cancel delegated Tasks here.
      void this.deps.interrupt(conversationId, runtime.activeRunId).catch(err => {
        log.warn({ err, conversationId, runId: runtime.activeRunId }, 'Conversation interruption failed; accepted input remains queued');
      });
    }
    void this.drain(conversationId);
  }

  private publish(conversationId: string): SessionInputState {
    const state = this.snapshot(conversationId);
    this.deps.emit('session.input-state', state);
    return state;
  }

  private async runSubmissionExclusive<T>(conversationId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.submissionTails.get(conversationId) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.submissionTails.set(conversationId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.submissionTails.get(conversationId) === tail) this.submissionTails.delete(conversationId);
    }
  }

  async withSubmission<T>(conversationId: string, operation: () => Promise<T>): Promise<T> {
    this.pendingSubmissions.set(conversationId, (this.pendingSubmissions.get(conversationId) ?? 0) + 1);
    try {
      this.deps.onInputReceived?.(conversationId);
      return await operation();
    } finally {
      const remaining = (this.pendingSubmissions.get(conversationId) ?? 1) - 1;
      if (remaining) this.pendingSubmissions.set(conversationId, remaining);
      else this.pendingSubmissions.delete(conversationId);
      void this.drain(conversationId);
    }
  }

  async submit(input: SubmitSessionInput): Promise<
    | { ok: true; effectiveDelivery: SessionInputDelivery; state: SessionInputState }
    | { ok: false; code: 'BAD_REQUEST' | 'QUEUE_FULL' | 'CONTEXT_UNAVAILABLE' | 'SESSION_CHANGED' }
  > {
    input = structuredClone(input);
    const conversationId = input.conversationId.trim();
    try {
      return await this.withSubmission(conversationId, () =>
        this.runSubmissionExclusive(conversationId, () => this.submitLocked({ ...input, conversationId })));
    } catch (error) {
      if (error instanceof SessionInstanceChangedError) return { ok: false, code: 'SESSION_CHANGED' };
      throw error;
    }
  }

  async replaceLatestTurn(
    input: ReplaceLatestTurnInput,
    beforeReplace: (allowAbort: boolean) => Promise<void>,
  ): Promise<
    | { ok: true; effectiveDelivery: 'next'; state: SessionInputState }
    | { ok: false; code: 'BAD_REQUEST' | 'TARGET_NOT_FOUND' | 'NOT_LATEST' | 'SESSION_BUSY' | 'CONTEXT_UNAVAILABLE' }
  > {
    input = structuredClone(input);
    const conversationId = input.conversationId.trim();
    this.deps.onInputReceived?.(conversationId);
    return this.runSubmissionExclusive(conversationId, async () => {
      const clientMessageId = input.clientMessageId.trim();
      const content = input.content.trim();
      const targetTurnId = input.targetTurnId.trim();
      if (!conversationId || !clientMessageId || !targetTurnId
        || (!content && !input.attachments?.length && !input.sourceContexts?.length)) {
        return { ok: false, code: 'BAD_REQUEST' };
      }
      if (!await this.deps.sessionExists(conversationId)) return { ok: false, code: 'BAD_REQUEST' };

      const existing = findSessionInput(conversationId, clientMessageId);
      if (existing) {
        input.origin = existing.origin;
        if (!sameAppContext(input, existing)) return { ok: false, code: 'CONTEXT_UNAVAILABLE' };
        return { ok: true, effectiveDelivery: 'next', state: this.snapshot(conversationId) };
      }

      const target = validateLatestSessionTurnTarget(conversationId, targetTurnId);
      if (target.ok === false) return target;

      const original = findSessionInputByRunId(conversationId, targetTurnId);
      if (original) {
        input.origin = original.origin;
        input.sourceContexts = [...(input.sourceContexts ?? []).filter(source => source.kind !== 'device_context'),
          ...(original.contextSnapshots ?? []).filter(source => source.kind === 'device_context')];
      }
      const attachments = await this.deps.prepareAttachments(conversationId, input.attachments);
      let sourceContexts: AgentSourceContext[] | undefined;
      try {
        const resolved = await this.deps.prepareContexts(conversationId, input.contextRefs) ?? [];
        sourceContexts = fitSourceContextsToBudget([...resolved, ...(input.sourceContexts ?? [])]);
      } catch (err) {
        log.warn({ err, conversationId }, 'Session input context preparation failed');
        return { ok: false, code: 'CONTEXT_UNAVAILABLE' };
      }
      const controlState = readSessionInputControl(conversationId);
      if (input.controlVersion !== undefined && input.controlVersion !== controlState.version) throw new SessionInputControlConflict('Queue control changed');
      if ((controlState.paused || input.controlVersion !== undefined) && controlState.phase !== 'idle') return { ok: false, code: 'SESSION_BUSY' };
      await beforeReplace(input.controlVersion === undefined);
      const result = replaceLatestSessionTurnAndQueueInput({
        conversationId,
        targetTurnId,
        expectedTranscriptId: input.expectedTranscriptId,
        controlVersion: input.controlVersion,
        clientMessageId,
        content,
        attachments,
        contextRefs: sourceContexts?.map(summarizeSourceContext),
        contextSnapshots: sourceContexts,
        thinking: input.thinking,
        origin: input.origin,
      });
      if (result.ok === false) return result;

      if (!result.idempotent) {
        cancelConnectionObjective(conversationId);
        supersedeActiveClarification(conversationId);
        const replacement = {
          role: 'user',
          content,
          media: attachments,
        } as unknown as AgentMessage;
        await deleteMediaUrisNoLongerReferenced({
          removed: result.removedMessages,
          remaining: [...result.remainingMessages, replacement],
        });
      }

      void this.drain(conversationId);
      return { ok: true, effectiveDelivery: 'next', state: this.publish(conversationId) };
    });
  }

  private async submitLocked(input: SubmitSessionInput): Promise<
    | { ok: true; effectiveDelivery: SessionInputDelivery; state: SessionInputState }
    | { ok: false; code: 'BAD_REQUEST' | 'QUEUE_FULL' | 'CONTEXT_UNAVAILABLE' | 'SESSION_CHANGED' }
  > {
    const conversationId = input.conversationId;
    const clientMessageId = input.clientMessageId.trim();
    const content = input.content.trim();
    if (!conversationId || !clientMessageId
      || (!content && !input.attachments?.length && !input.sourceContexts?.length)) {
      return { ok: false, code: 'BAD_REQUEST' };
    }
    if (!await this.deps.sessionExists(conversationId)) return { ok: false, code: 'BAD_REQUEST' };

    const existing = findSessionInput(conversationId, clientMessageId);
    if (existing) {
      if (!sameAppContext(input, existing)) return { ok: false, code: 'CONTEXT_UNAVAILABLE' };
      return { ok: true, effectiveDelivery: existing.effectiveDelivery, state: this.snapshot(conversationId) };
    }
    if (this.snapshot(conversationId).inputs.length >= MAX_PENDING_INPUTS) {
      return { ok: false, code: 'QUEUE_FULL' };
    }

    const attachments = await this.deps.prepareAttachments(conversationId, input.attachments);
    let sourceContexts: AgentSourceContext[] | undefined;
    try {
      const resolved = await this.deps.prepareContexts(conversationId, input.contextRefs) ?? [];
      sourceContexts = fitSourceContextsToBudget([...resolved, ...(input.sourceContexts ?? [])]);
    } catch (err) {
      log.warn({ err, conversationId }, 'Session input context preparation failed');
      return { ok: false, code: 'CONTEXT_UNAVAILABLE' };
    }
    const runtime = this.snapshot(conversationId);
    const phoneWait = phoneAssistance(conversationId);
    const completedPhone = /^(?:我已(?:完成|登录|登陆|输入验证码)[，,、\s]*(?:请)?继续(?:原任务|任务)?|(?:登录|登陆|验证码|手机操作)(?:已)?完成[了]?[，,、\s]*(?:请)?继续(?:原任务|任务)?|好了[，,、\s]*继续(?:原任务|任务)?|(?:i(?: have|'ve) )?(?:logged in|finished on the phone|completed the phone action)[,\s]+(?:please )?(?:continue|resume)(?: the task)?)[。.!！\s]*$/iu.test(content);
    if (completedPhone && phoneWait?.status === 'open' && this.deps.completePhone && input.origin.type !== 'system'
      && !attachments?.length && !input.contextRefs?.length && !getActiveConnectionWait(conversationId) && !getActiveClarification(conversationId)) {
      if (input.expectedTranscriptId && input.expectedTranscriptId !== phoneWait.transcriptId) return { ok: false, code: 'SESSION_CHANGED' };
      await this.deps.completePhone(phoneWait);
      runSqliteWriteTransaction(() => {
        const row = insertSessionInput({ id: crypto.randomUUID(), conversationId, clientMessageId, expectedTranscriptId: phoneWait.transcriptId,
          content, requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', origin: input.origin });
        queuePhoneAssistance(conversationId, phoneWait.id);
        appendTranscriptEntry(conversationId, { role: 'user', content, timestamp: row.createdAtMs });
        setSessionInputStatus(row.id, 'completed');
      });
      emitSessionTranscriptUpdate({ conversationId });
      void this.drain(conversationId);
      return { ok: true, effectiveDelivery: 'next', state: this.publish(conversationId) };
    }
    const wait = this.connectionTarget(conversationId, runtime);
    const control = wait?.principalId === 'local-owner' ? connectionControl(input, wait) : undefined;
    const payload = connectionInputPayload(wait, control);
    const priority = !runtime.control.paused && !wait && input.interrupt !== false && this.deps.prioritizeInput?.(input) === true;
    const canSteer = !runtime.control.paused && !wait && !priority && input.delivery === 'steer'
      && runtime.activeRunId !== undefined
      && !attachments?.length
      && canSteerContexts(runtime, input.origin, sourceContexts);
    const effectiveDelivery: SessionInputDelivery = canSteer ? 'steer' : 'next';
    const row = runSqliteWriteTransaction(() => {
      const row = insertSessionInput({
        expectedTranscriptId: input.expectedTranscriptId ?? (payload ? wait?.transcriptId : undefined),
        id: crypto.randomUUID(),
        conversationId,
        clientMessageId,
        requestedDelivery: input.delivery,
        interruptRequested: priority,
        effectiveDelivery,
        status: canSteer ? 'injecting' : 'queued',
        content,
        attachments,
        contextRefs: sourceContexts?.map(summarizeSourceContext),
        contextSnapshots: sourceContexts,
        thinking: input.thinking,
        origin: input.origin,
        targetRunId: canSteer ? runtime.activeRunId : undefined,
        ...(payload ? { payload } : {}),
      });
      if (control === 'cancel') cancelConnectionObjective(conversationId, wait?.id, wait?.objectiveRevision);
      return row;
    });
    if (control === 'cancel') this.completeConnectionCancellation(row);
    this.requestConnectionStop(row);
    supersedeActiveClarification(conversationId);
    if (priority) {
      this.prioritizeAcceptedInput(row, runtime);
      return { ok: true, effectiveDelivery: 'next', state: this.publish(conversationId) };
    }
    if (canSteer) {
      const accepted = await this.deps.steer(conversationId, steeringText(content, sourceContexts), runtime.activeRunId);
      if (!accepted) {
        setSessionInputStatus(row.id, 'queued', { effectiveDelivery: 'next', targetRunId: null });
        void this.drain(conversationId);
        return { ok: true, effectiveDelivery: 'next', state: this.publish(conversationId) };
      }
      return { ok: true, effectiveDelivery: 'steer', state: this.publish(conversationId) };
    }

    void this.drain(conversationId);
    return { ok: true, effectiveDelivery: 'next', state: this.publish(conversationId) };
  }

  async drain(conversationId: string): Promise<void> {
    if (this.draining.has(conversationId)) return;
    this.draining.add(conversationId);
    try {
      while (true) {
        // Attachment/context validation is asynchronous; do not consume a recovery ahead of it.
        if (this.isAcceptingInput(conversationId)) return;
        const delay = (this.resumeAfter.get(conversationId) ?? 0) - Date.now();
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        this.resumeAfter.delete(conversationId);
        const runId = crypto.randomUUID();
        const input = claimNextSessionInput(conversationId, runId);
        if (!input) return;
        let allowed: boolean;
        try {
          allowed = !this.deps.beforeExecute || await this.deps.beforeExecute(input);
          const wait = input.kind === 'connection_resume' && input.payload ? getConnectionWait(input.payload.waitId) : undefined;
          if (allowed && wait?.status === 'queued' && wait.queuedInputId === input.id
            && (this.isAcceptingInput(conversationId) || hasPendingConnectionMessages(wait, true))) {
            finishSessionInputRun(conversationId, runId, 'interrupted');
            setSessionInputStatus(input.id, 'queued');
            this.publish(conversationId);
            continue;
          }
          allowed = allowed && readSessionInputControl(conversationId).phase !== 'stopping';
          allowed = allowed && consumeConnectionResume(input) && consumeClarificationResume(input) && consumePhoneAssistance(input);
        } catch (err) {
          log.warn({ err, conversationId, runId, inputId: input.id }, 'Session input preflight failed');
          finishPhoneAssistance(input, false);
          finishSessionInputRun(conversationId, runId, 'failed', 'Input preflight failed');
          if (input.kind === 'connection_resume') reconcileConnectionWaits();
          this.publish(conversationId);
          continue;
        }
        if (!allowed) {
          finishSessionInputRun(conversationId, runId, 'cancelled');
          finishPhoneAssistance(input, false);
          this.publish(conversationId);
          continue;
        }
        if (input.kind === 'connection_resume') publishConnectionWait(conversationId);
        this.publish(conversationId);
        let result: { status: string; summary: string };
        try {
          result = input.payload?.connectionAction ? await this.executeConnectionControl(input) : await this.deps.execute({
            inputReceivedAtMs: input.createdAtMs,
            runId,
            taskRunId: input.taskRunId,
            conversationId,
            content: input.content,
            attachments: input.attachments as UserTurnAttachment[] | undefined,
            sourceContexts: input.contextSnapshots,
            thinking: input.thinking,
            origin: input.origin,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result = { status: 'error', summary: message };
          log.warn({ err: error, conversationId, runId, inputId: input.id }, 'Session input execution failed');
        }
        const cancelledWait = input.kind === 'connection_resume' && input.payload ? getConnectionWait(input.payload.waitId) : undefined;
        const cancelled = cancelledWait?.resolution === 'cancelled' && cancelledWait.objectiveRevision === input.payload?.objectiveRevision;
        if (cancelled && input.taskRunId) {
          const runs = new TaskRunRepository();
          const run = runs.get(input.taskRunId);
          if (run && ['queued', 'running', 'waiting', 'verifying'].includes(run.status)) {
            new TaskApplicationService().completeRun({ runId: run.id, expectedRunVersion: run.version,
              actor: { kind: 'user' }, terminalCode: 'cancelled_by_user', suppressAttention: true,
              receipt: { status: 'cancelled', summary: 'Connection objective cancelled', changes: [], evidence: [],
                verification: { status: 'unverified', checks: [] }, remainingWork: [], needsUser: false, completionVerdict: 'not_achieved' } });
          }
        }
        const terminal = cancelled ? 'cancelled' : result.status === 'suspended' ? 'suspended' : result.status === 'ok'
          ? 'completed'
          : result.status === 'aborted'
            ? 'cancelled'
            : 'failed';
        finishSessionInputRun(conversationId, runId, terminal, terminal === 'failed' ? result.summary : undefined);
        finishPhoneAssistance(input, terminal === 'completed');
        this.publish(conversationId);
      }
    } finally {
      this.draining.delete(conversationId);
    }
  }

  private requestConnectionStop(input: SessionInput): void {
    const target = input.payload;
    if (target?.connectionAction !== 'cancel' || !this.deps.interrupt) return;
    const wait = getConnectionWait(target.waitId);
    if (!wait || wait.resolution !== 'cancelled' || wait.objectiveRevision !== target.objectiveRevision
      || wait.transcriptId !== input.expectedTranscriptId) return;
    const runtime = this.snapshot(input.conversationId);
    const active = runtime.activeInputId ? getSessionInputById(input.conversationId, runtime.activeInputId) : undefined;
    if (!runtime.activeRunId || active?.kind !== 'connection_resume' || !active.payload) return;
    const sameVersion = active.payload.waitId === target.waitId && active.payload.objectiveRevision === target.objectiveRevision;
    const parent = getConnectionWait(active.payload.waitId);
    const sameExecution = wait.originInputId === active.id && parent?.objectiveId === wait.objectiveId;
    if ((!sameVersion && !sameExecution) || this.pendingConnectionStops.has(runtime.activeRunId)) return;
    const runId = runtime.activeRunId;
    this.pendingConnectionStops.add(runId);
    this.deps.emit('session.input-interrupt', { conversationId: input.conversationId, runId, inputId: input.id });
    // Acceptance must not wait for an SDK/tool to acknowledge cancellation.
    void this.deps.interrupt(input.conversationId, runId, 'connection_cancel').catch(err => {
      log.warn({ err, conversationId: input.conversationId, runId }, 'Connection cancellation saved; execution stop was not confirmed');
    }).finally(() => { this.pendingConnectionStops.delete(runId); });
  }

  private completeConnectionCancellation(input: SessionInput): void {
    const wait = input.payload ? getConnectionWait(input.payload.waitId) : undefined;
    if (wait?.objectiveRevision !== input.payload?.objectiveRevision || wait?.resolution !== 'cancelled') return;
    try { this.deps.cancelConnection?.(wait); }
    catch (err) {
      log.warn({ err, conversationId: input.conversationId, waitId: wait.id }, 'Connection cancellation saved; domain cleanup will retry with its control');
    }
  }

  private async executeConnectionControl(input: SessionInput): Promise<{ status: string; summary: string }> {
    const target = input.payload;
    if (!target?.connectionAction) throw new Error('Connection control is required');
    let wait = getConnectionWait(target.waitId);
    if (target.connectionAction === 'cancel' && wait?.objectiveRevision === target.objectiveRevision) {
      this.deps.cancelConnection?.(wait);
    }
    if (target.connectionAction === 'continue' && wait?.objectiveRevision === target.objectiveRevision) {
      try { await this.deps.continueConnection?.(wait, `connection-control:${input.id}`); }
      catch (err) {
        log.warn({ err, conversationId: input.conversationId, waitId: target.waitId }, 'Connection control preserved for current status feedback');
      }
    }
    wait = getConnectionWait(target.waitId);
    const zh = /[\u3400-\u9fff]/u.test(input.content);
    const changed = !wait || wait.objectiveRevision !== target.objectiveRevision;
    const summary = changed ? (zh ? '原目标已发生变化，请查看当前目标状态。' : 'The original objective changed. Check the current objective status.')
      : target.connectionAction === 'cancel' ? (zh ? '已取消原目标。' : 'The original objective was cancelled.')
        : interruptedConnectionMessage(wait) ? (zh ? '原目标已保留。请重新发送重启时中断的补充要求，或移除中断的消息后继续。' : 'The original objective is saved. Resend the interrupted message or remove it before continuing.')
        : wait.resolution === 'cancelled' ? (zh ? '原目标已取消。' : 'The original objective was cancelled.')
          : wait.status === 'closed' ? (zh ? '原目标已交给执行流程，无需重复继续。' : 'The original objective has already been handed to execution. No additional continuation is needed.')
          : wait.status === 'queued' ? (zh ? '原目标已准备好，正在等待执行，无需重复继续。' : 'The original objective is queued. No additional continuation is needed.')
            : wait.intent ? (zh ? '原目标已保留，完成连接和能力检查后会自动继续。' : 'The original objective is saved and will continue automatically after connection and capability checks.')
              : (zh ? '原目标已保留，请查看连接操作区完成所需操作。' : 'The original objective is saved. Complete the required action in the connection panel.');
    const persisted = runSqliteWriteTransaction(() => {
      const runtime = this.snapshot(input.conversationId);
      if (runtime.activeInputId !== input.id || runtime.activeRunId !== input.runId
        || readCurrentTranscriptId(getSqliteDatabase(), input.conversationId) !== input.expectedTranscriptId) return false;
      appendTranscriptEntry(input.conversationId, { role: 'user', content: input.content, timestamp: input.createdAtMs });
      appendTranscriptEntry(input.conversationId, { role: 'custom', customType: 'connection_control_status', content: summary,
        details: { inputId: input.id, waitId: target.waitId, objectiveRevision: target.objectiveRevision }, display: true, timestamp: Date.now() });
      finishSessionInputRun(input.conversationId, input.runId!, 'completed');
      return true;
    });
    if (persisted) emitSessionTranscriptUpdate({ conversationId: input.conversationId });
    return { status: persisted ? 'ok' : 'aborted', summary: persisted ? summary : '' };
  }

  async update(conversationId: string, id: string, body: {
    version: number; content?: string; attachments?: UserTurnAttachment[]; contextRefs?: TurnContextRef[];
    thinking?: string; position?: number;
  }): Promise<{ ok: boolean; state: SessionInputState; contextUnavailable?: boolean }> {
    const attachments = body.attachments === undefined
      ? undefined
      : await this.deps.prepareAttachments(conversationId, body.attachments);
    let sourceContexts: AgentSourceContext[] | undefined;
    if (body.contextRefs !== undefined) {
      const existing = getSessionInputById(conversationId, id);
      if (!contextRefsMatchFrozenSnapshot(body.contextRefs, existing?.contextRefs)) {
        try {
          const resolved = await this.deps.prepareContexts(conversationId, body.contextRefs) ?? [];
          const captured = existing?.contextSnapshots?.filter(
            source => source.kind === 'app_context' || source.kind === 'browser_page' || source.kind === 'device_context',
          ) ?? [];
          sourceContexts = fitSourceContextsToBudget([...captured, ...resolved]);
        } catch (err) {
          log.warn({ err, conversationId, inputId: id }, 'Queued input context preparation failed');
          return { ok: false, contextUnavailable: true, state: this.snapshot(conversationId) };
        }
      }
    }
    const ok = mutateQueuedSessionInput({
      conversationId,
      id,
      ...body,
      attachments,
      contextRefs: sourceContexts?.map(summarizeSourceContext),
      contextSnapshots: sourceContexts,
    });
    return { ok, state: ok ? this.publish(conversationId) : this.snapshot(conversationId) };
  }

  remove(conversationId: string, id: string, version: number): { ok: boolean; state: SessionInputState } {
    const ok = cancelQueuedSessionInput(conversationId, id, version);
    if (ok) {
      publishConnectionWait(conversationId);
      void this.drain(conversationId);
    }
    return { ok, state: ok ? this.publish(conversationId) : this.snapshot(conversationId) };
  }

  async waitForCompletion(conversationId: string, clientMessageId: string): Promise<void> {
    while (true) {
      const row = findSessionInput(conversationId, clientMessageId);
      if (!row) throw new Error('Session input disappeared before completion');
      if (row.status === 'completed' || row.status === 'suspended') return;
      if (row.status === 'failed' || row.status === 'cancelled' || row.status === 'interrupted') {
        throw new Error(row.error ?? `Session input ended with status ${row.status}`);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }

  recover(): void {
    const interrupted = recoverSessionInputState();
    new TaskRunRepository().reconcileCancelledRuns();
    for (const conversationId of new Set([...interrupted, ...reconcileConnectionWaits(true), ...reconcilePhoneAssistance()])) {
      this.publish(conversationId);
      void this.drain(conversationId);
    }
  }
}

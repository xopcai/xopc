import crypto from 'node:crypto';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';

import type { SessionInput } from '../../storage/sqlite/session-input-repository.js';
import { consumeConnectionResume, publishConnectionWait, invalidateConnectionResumeIntent, cancelConnectionObjective } from '../../storage/sqlite/connection-wait-repository.js';
import {
  consumeClarificationResume,
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

const log = createLogger('SessionInputCoordinator');
const MAX_PENDING_INPUTS = 10;

function contextRefsMatchFrozenSnapshot(
  requested: readonly TurnContextRef[],
  frozen: SessionInputState['inputs'][number]['contextRefs'],
): boolean {
  if (requested.length !== (frozen?.length ?? 0)) return false;
  return requested.every((ref, index) => {
    const snapshot = frozen?.[index];
    return snapshot?.kind === ref.kind
      && snapshot.sourceId === ref.sourceId
      && ref.expectedVersion === snapshot.version;
  });
}

export type SubmitSessionInput = {
  expectedTranscriptId?: string;
  conversationId: string;
  clientMessageId: string;
  delivery: SessionInputDelivery;
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
  private readonly draining = new Set<string>();
  private readonly submissionTails = new Map<string, Promise<void>>();

  constructor(private readonly deps: {
    beforeExecute?: (input: SessionInput) => Promise<boolean>;
    sessionExists: (conversationId: string) => Promise<boolean>;
    execute: (input: {
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
    prepareContexts: (contextRefs?: TurnContextRef[]) => Promise<AgentSourceContext[] | undefined>;
    steer: (conversationId: string, content: string) => Promise<boolean>;
    emit: (type: string, payload: unknown) => void;
  }) {}

  snapshot(conversationId: string): SessionInputState {
    return getSessionInputState(conversationId);
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

  async submit(input: SubmitSessionInput): Promise<
    | { ok: true; effectiveDelivery: SessionInputDelivery; state: SessionInputState }
    | { ok: false; code: 'BAD_REQUEST' | 'QUEUE_FULL' | 'CONTEXT_UNAVAILABLE' | 'SESSION_CHANGED' }
  > {
    const conversationId = input.conversationId.trim();
    try {
      return await this.runSubmissionExclusive(conversationId, () => this.submitLocked({ ...input, conversationId }));
    } catch (error) {
      if (error instanceof SessionInstanceChangedError) return { ok: false, code: 'SESSION_CHANGED' };
      throw error;
    }
  }

  async replaceLatestTurn(
    input: ReplaceLatestTurnInput,
    beforeReplace: () => Promise<void>,
  ): Promise<
    | { ok: true; effectiveDelivery: 'next'; state: SessionInputState }
    | { ok: false; code: 'BAD_REQUEST' | 'TARGET_NOT_FOUND' | 'NOT_LATEST' | 'SESSION_BUSY' | 'CONTEXT_UNAVAILABLE' }
  > {
    const conversationId = input.conversationId.trim();
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
        return { ok: true, effectiveDelivery: 'next', state: this.snapshot(conversationId) };
      }

      const target = validateLatestSessionTurnTarget(conversationId, targetTurnId);
      if (target.ok === false) return target;

      await beforeReplace();
      const attachments = await this.deps.prepareAttachments(conversationId, input.attachments);
      let sourceContexts: AgentSourceContext[] | undefined;
      try {
        const resolved = await this.deps.prepareContexts(input.contextRefs) ?? [];
        sourceContexts = fitSourceContextsToBudget([...resolved, ...(input.sourceContexts ?? [])]);
      } catch (err) {
        log.warn({ err, conversationId }, 'Session input context preparation failed');
        return { ok: false, code: 'CONTEXT_UNAVAILABLE' };
      }
      const result = replaceLatestSessionTurnAndQueueInput({
        conversationId,
        targetTurnId,
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
      return { ok: true, effectiveDelivery: existing.effectiveDelivery, state: this.snapshot(conversationId) };
    }
    if (this.snapshot(conversationId).inputs.length >= MAX_PENDING_INPUTS) {
      return { ok: false, code: 'QUEUE_FULL' };
    }

    const attachments = await this.deps.prepareAttachments(conversationId, input.attachments);
    let sourceContexts: AgentSourceContext[] | undefined;
    try {
      const resolved = await this.deps.prepareContexts(input.contextRefs) ?? [];
      sourceContexts = fitSourceContextsToBudget([...resolved, ...(input.sourceContexts ?? [])]);
    } catch (err) {
      log.warn({ err, conversationId }, 'Session input context preparation failed');
      return { ok: false, code: 'CONTEXT_UNAVAILABLE' };
    }
    const runtime = this.snapshot(conversationId);
    const canSteer = input.origin.type !== 'endpoint'
      && input.delivery === 'steer'
      && runtime.activeRunId !== undefined
      && !attachments?.length
      && !sourceContexts?.length;
    const effectiveDelivery: SessionInputDelivery = canSteer ? 'steer' : 'next';
    const row = insertSessionInput({
      expectedTranscriptId: input.expectedTranscriptId,
      id: crypto.randomUUID(),
      conversationId,
      clientMessageId,
      requestedDelivery: input.delivery,
      effectiveDelivery,
      status: canSteer ? 'injecting' : 'queued',
      content,
      attachments,
      contextRefs: sourceContexts?.map(summarizeSourceContext),
      contextSnapshots: sourceContexts,
      thinking: input.thinking,
      origin: input.origin,
      targetRunId: canSteer ? runtime.activeRunId : undefined,
    });

    invalidateConnectionResumeIntent(conversationId);
    supersedeActiveClarification(conversationId);
    if (canSteer) {
      const accepted = await this.deps.steer(conversationId, content);
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
        const runId = crypto.randomUUID();
        const input = claimNextSessionInput(conversationId, runId);
        if (!input) return;
        if ((this.deps.beforeExecute && !await this.deps.beforeExecute(input))
          || !consumeConnectionResume(input)
          || !consumeClarificationResume(input)) {
          finishSessionInputRun(conversationId, runId, 'cancelled');
          this.publish(conversationId);
          continue;
        }
        if (input.kind === 'connection_resume') publishConnectionWait(conversationId);
        this.publish(conversationId);
        let result: { status: string; summary: string };
        try {
          result = await this.deps.execute({
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
        const terminal = result.status === 'suspended' ? 'suspended' : result.status === 'ok'
          ? 'completed'
          : result.status === 'aborted'
            ? 'cancelled'
            : 'failed';
        finishSessionInputRun(conversationId, runId, terminal, terminal === 'failed' ? result.summary : undefined);
        this.publish(conversationId);
      }
    } finally {
      this.draining.delete(conversationId);
    }
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
          sourceContexts = await this.deps.prepareContexts(body.contextRefs) ?? [];
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
    for (const conversationId of recoverSessionInputState()) {
      this.publish(conversationId);
      void this.drain(conversationId);
    }
  }
}

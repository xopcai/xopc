import crypto from 'node:crypto';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';

import type { UserTurnAttachment } from '../user-turn-input.js';
import {
  cancelQueuedSessionInput,
  claimNextSessionInput,
  findSessionInput,
  finishSessionInputRun,
  getSessionInputState,
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

const log = createLogger('SessionInputCoordinator');
const MAX_PENDING_INPUTS = 10;

export type SubmitSessionInput = {
  sessionKey: string;
  clientMessageId: string;
  delivery: SessionInputDelivery;
  content: string;
  attachments?: UserTurnAttachment[];
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
    sessionExists: (sessionKey: string) => Promise<boolean>;
    execute: (input: {
      runId: string;
      sessionKey: string;
      content: string;
      attachments?: UserTurnAttachment[];
      thinking?: string;
      origin: TurnOrigin;
    }) => Promise<{ status: string; summary: string }>;
    prepareAttachments: (
      sessionKey: string,
      attachments?: UserTurnAttachment[],
    ) => Promise<UserTurnAttachment[] | undefined>;
    steer: (sessionKey: string, content: string) => Promise<boolean>;
    emit: (type: string, payload: unknown) => void;
  }) {}

  snapshot(sessionKey: string): SessionInputState {
    return getSessionInputState(sessionKey);
  }

  private publish(sessionKey: string): SessionInputState {
    const state = this.snapshot(sessionKey);
    this.deps.emit('session.input-state', state);
    return state;
  }

  private async runSubmissionExclusive<T>(sessionKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.submissionTails.get(sessionKey) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.submissionTails.set(sessionKey, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.submissionTails.get(sessionKey) === tail) this.submissionTails.delete(sessionKey);
    }
  }

  async submit(input: SubmitSessionInput): Promise<
    | { ok: true; effectiveDelivery: SessionInputDelivery; state: SessionInputState }
    | { ok: false; code: 'BAD_REQUEST' | 'QUEUE_FULL' }
  > {
    const sessionKey = input.sessionKey.trim();
    return this.runSubmissionExclusive(sessionKey, () => this.submitLocked({ ...input, sessionKey }));
  }

  async replaceLatestTurn(
    input: ReplaceLatestTurnInput,
    beforeReplace: () => Promise<void>,
  ): Promise<
    | { ok: true; effectiveDelivery: 'next'; state: SessionInputState }
    | { ok: false; code: 'BAD_REQUEST' | 'TARGET_NOT_FOUND' | 'NOT_LATEST' | 'SESSION_BUSY' }
  > {
    const sessionKey = input.sessionKey.trim();
    return this.runSubmissionExclusive(sessionKey, async () => {
      const clientMessageId = input.clientMessageId.trim();
      const content = input.content.trim();
      const targetTurnId = input.targetTurnId.trim();
      if (!sessionKey || !clientMessageId || !targetTurnId || (!content && !input.attachments?.length)) {
        return { ok: false, code: 'BAD_REQUEST' };
      }
      if (!await this.deps.sessionExists(sessionKey)) return { ok: false, code: 'BAD_REQUEST' };

      const existing = findSessionInput(sessionKey, clientMessageId);
      if (existing) {
        return { ok: true, effectiveDelivery: 'next', state: this.snapshot(sessionKey) };
      }

      const target = validateLatestSessionTurnTarget(sessionKey, targetTurnId);
      if (target.ok === false) return target;

      await beforeReplace();
      const attachments = await this.deps.prepareAttachments(sessionKey, input.attachments);
      const result = replaceLatestSessionTurnAndQueueInput({
        sessionKey,
        targetTurnId,
        clientMessageId,
        content,
        attachments,
        thinking: input.thinking,
        origin: input.origin,
      });
      if (result.ok === false) return result;

      if (!result.idempotent) {
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

      void this.drain(sessionKey);
      return { ok: true, effectiveDelivery: 'next', state: this.publish(sessionKey) };
    });
  }

  private async submitLocked(input: SubmitSessionInput): Promise<
    | { ok: true; effectiveDelivery: SessionInputDelivery; state: SessionInputState }
    | { ok: false; code: 'BAD_REQUEST' | 'QUEUE_FULL' }
  > {
    const sessionKey = input.sessionKey;
    const clientMessageId = input.clientMessageId.trim();
    const content = input.content.trim();
    if (!sessionKey || !clientMessageId || (!content && !input.attachments?.length)) {
      return { ok: false, code: 'BAD_REQUEST' };
    }
    if (!await this.deps.sessionExists(sessionKey)) return { ok: false, code: 'BAD_REQUEST' };

    const existing = findSessionInput(sessionKey, clientMessageId);
    if (existing) {
      return { ok: true, effectiveDelivery: existing.effectiveDelivery, state: this.snapshot(sessionKey) };
    }
    if (this.snapshot(sessionKey).inputs.length >= MAX_PENDING_INPUTS) {
      return { ok: false, code: 'QUEUE_FULL' };
    }

    const attachments = await this.deps.prepareAttachments(sessionKey, input.attachments);
    const runtime = this.snapshot(sessionKey);
    const canSteer = input.origin.type !== 'endpoint'
      && input.delivery === 'steer'
      && runtime.activeRunId !== undefined
      && !attachments?.length;
    const effectiveDelivery: SessionInputDelivery = canSteer ? 'steer' : 'next';
    const row = insertSessionInput({
      id: crypto.randomUUID(),
      sessionKey,
      clientMessageId,
      requestedDelivery: input.delivery,
      effectiveDelivery,
      status: canSteer ? 'injecting' : 'queued',
      content,
      attachments,
      thinking: input.thinking,
      origin: input.origin,
      targetRunId: canSteer ? runtime.activeRunId : undefined,
    });

    if (canSteer) {
      const accepted = await this.deps.steer(sessionKey, content);
      if (!accepted) {
        setSessionInputStatus(row.id, 'queued', { effectiveDelivery: 'next', targetRunId: null });
        void this.drain(sessionKey);
        return { ok: true, effectiveDelivery: 'next', state: this.publish(sessionKey) };
      }
      return { ok: true, effectiveDelivery: 'steer', state: this.publish(sessionKey) };
    }

    void this.drain(sessionKey);
    return { ok: true, effectiveDelivery: 'next', state: this.publish(sessionKey) };
  }

  async drain(sessionKey: string): Promise<void> {
    if (this.draining.has(sessionKey)) return;
    this.draining.add(sessionKey);
    try {
      while (true) {
        const runId = crypto.randomUUID();
        const input = claimNextSessionInput(sessionKey, runId);
        if (!input) return;
        this.publish(sessionKey);
        let result: { status: string; summary: string };
        try {
          result = await this.deps.execute({
            runId,
            sessionKey,
            content: input.content,
            attachments: input.attachments as UserTurnAttachment[] | undefined,
            thinking: input.thinking,
            origin: input.origin,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result = { status: 'error', summary: message };
          log.warn({ err: error, sessionKey, runId, inputId: input.id }, 'Session input execution failed');
        }
        const terminal = result.status === 'ok'
          ? 'completed'
          : result.status === 'aborted'
            ? 'cancelled'
            : 'failed';
        finishSessionInputRun(sessionKey, runId, terminal, terminal === 'failed' ? result.summary : undefined);
        this.publish(sessionKey);
      }
    } finally {
      this.draining.delete(sessionKey);
    }
  }

  async update(sessionKey: string, id: string, body: {
    version: number; content?: string; attachments?: UserTurnAttachment[]; thinking?: string; position?: number;
  }): Promise<{ ok: boolean; state: SessionInputState }> {
    const attachments = body.attachments === undefined
      ? undefined
      : await this.deps.prepareAttachments(sessionKey, body.attachments);
    const ok = mutateQueuedSessionInput({ sessionKey, id, ...body, attachments });
    return { ok, state: ok ? this.publish(sessionKey) : this.snapshot(sessionKey) };
  }

  remove(sessionKey: string, id: string, version: number): { ok: boolean; state: SessionInputState } {
    const ok = cancelQueuedSessionInput(sessionKey, id, version);
    return { ok, state: ok ? this.publish(sessionKey) : this.snapshot(sessionKey) };
  }

  async waitForCompletion(sessionKey: string, clientMessageId: string): Promise<void> {
    while (true) {
      const row = findSessionInput(sessionKey, clientMessageId);
      if (!row) throw new Error('Session input disappeared before completion');
      if (row.status === 'completed') return;
      if (row.status === 'failed' || row.status === 'cancelled' || row.status === 'interrupted') {
        throw new Error(row.error ?? `Session input ended with status ${row.status}`);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }

  recover(): void {
    for (const sessionKey of recoverSessionInputState()) {
      this.publish(sessionKey);
      void this.drain(sessionKey);
    }
  }
}

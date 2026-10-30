import type { AgentSession } from '@earendil-works/pi-coding-agent';

import { AgentRunCancelledError } from '../orchestration/run-termination.js';

export type EmbeddedRunIdentity = {
  conversationId: string;
  transcriptId: string;
  runId: string;
};

export type EmbeddedRunHandle = EmbeddedRunIdentity & {
  session: AgentSession;
  abort: () => Promise<void>;
};

type PendingEmbeddedRun = EmbeddedRunIdentity & {
  handle?: EmbeddedRunHandle;
  abortController: AbortController;
};

export class EmbeddedRunConflictError extends Error {
  constructor(readonly conversationId: string, readonly activeRunId: string) {
    super(`Session '${conversationId}' already has active embedded run '${activeRunId}'`);
    this.name = 'EmbeddedRunConflictError';
  }
}

export type EmbeddedRunLease = {
  signal: AbortSignal;
  attach(session: AgentSession, abort: () => Promise<void>): Promise<void>;
  release(): void;
};

export type EmbeddedRunCancellation = {
  signal: AbortSignal;
  release(): void;
};

/** Owns one process-local execution lease per session while leaving steer/abort on the control plane. */
export class EmbeddedRunRegistry {
  private readonly byConversationId = new Map<string, PendingEmbeddedRun>();
  private readonly prepared = new Map<string, AbortController>();

  reserveCancellation(identity: Pick<EmbeddedRunIdentity, 'conversationId' | 'runId'>): EmbeddedRunCancellation {
    const key = JSON.stringify([identity.conversationId, identity.runId]);
    if (this.prepared.has(key)) throw new EmbeddedRunConflictError(identity.conversationId, identity.runId);
    const controller = new AbortController();
    this.prepared.set(key, controller);
    return { signal: controller.signal, release: () => {
      if (this.prepared.get(key) === controller) this.prepared.delete(key);
    } };
  }

  acquire(identity: EmbeddedRunIdentity): EmbeddedRunLease {
    const active = this.byConversationId.get(identity.conversationId);
    if (active) throw new EmbeddedRunConflictError(identity.conversationId, active.runId);

    const controller = this.prepared.get(JSON.stringify([identity.conversationId, identity.runId]));
    const entry: PendingEmbeddedRun = { ...identity, abortController: controller ?? new AbortController() };
    this.byConversationId.set(identity.conversationId, entry);

    return {
      signal: entry.abortController.signal,
      attach: async (session, abort) => {
        entry.handle = { ...identity, session, abort };
        if (entry.abortController.signal.aborted) await abort();
      },
      release: () => {
        if (this.byConversationId.get(identity.conversationId) === entry) {
          this.byConversationId.delete(identity.conversationId);
        }
      },
    };
  }

  getByConversationId(conversationId: string): EmbeddedRunHandle | undefined {
    return this.byConversationId.get(conversationId)?.handle;
  }

  async abortByConversationId(conversationId: string, reason: 'user_cancelled' | 'parent_cancelled' = 'parent_cancelled', expectedRunId?: string): Promise<boolean> {
    const entry = this.byConversationId.get(conversationId);
    if (!entry || (expectedRunId !== undefined && entry.runId !== expectedRunId)) {
      const prepared = expectedRunId === undefined ? undefined : this.prepared.get(JSON.stringify([conversationId, expectedRunId]));
      if (!prepared) return false;
      prepared.abort(new AgentRunCancelledError('Embedded run aborted', reason));
      return true;
    }
    entry.abortController.abort(new AgentRunCancelledError('Embedded run aborted', reason));
    if (entry.handle) await entry.handle.abort();
    return true;
  }

  async steerByConversationId(conversationId: string, text: string, expectedRunId?: string): Promise<boolean> {
    const handle = this.getByConversationId(conversationId);
    if (!handle || (expectedRunId !== undefined && handle.runId !== expectedRunId)
      || this.byConversationId.get(conversationId)?.abortController.signal.aborted) {
      return false;
    }
    await handle.session.steer(text);
    return true;
  }

  size(): number {
    return this.byConversationId.size;
  }
}

const embeddedRunRegistry = new EmbeddedRunRegistry();

export function acquireEmbeddedRunLease(identity: EmbeddedRunIdentity): EmbeddedRunLease {
  return embeddedRunRegistry.acquire(identity);
}

export function reserveEmbeddedRunCancellation(identity: Pick<EmbeddedRunIdentity, 'conversationId' | 'runId'>): EmbeddedRunCancellation {
  return embeddedRunRegistry.reserveCancellation(identity);
}

export function getEmbeddedRunByConversationId(conversationId: string): EmbeddedRunHandle | undefined {
  return embeddedRunRegistry.getByConversationId(conversationId);
}

export function abortEmbeddedRun(conversationId: string, reason: 'user_cancelled' | 'parent_cancelled' = 'parent_cancelled', expectedRunId?: string): Promise<boolean> {
  return embeddedRunRegistry.abortByConversationId(conversationId, reason, expectedRunId);
}

export function queueEmbeddedSteer(conversationId: string, text: string, expectedRunId?: string): Promise<boolean> {
  return embeddedRunRegistry.steerByConversationId(conversationId, text, expectedRunId);
}

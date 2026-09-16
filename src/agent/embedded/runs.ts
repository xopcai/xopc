import type { AgentSession } from '@earendil-works/pi-coding-agent';

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

/** Owns one process-local execution lease per session while leaving steer/abort on the control plane. */
export class EmbeddedRunRegistry {
  private readonly byConversationId = new Map<string, PendingEmbeddedRun>();

  acquire(identity: EmbeddedRunIdentity): EmbeddedRunLease {
    const active = this.byConversationId.get(identity.conversationId);
    if (active) throw new EmbeddedRunConflictError(identity.conversationId, active.runId);

    const entry: PendingEmbeddedRun = { ...identity, abortController: new AbortController() };
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

  async abortByConversationId(conversationId: string): Promise<boolean> {
    const entry = this.byConversationId.get(conversationId);
    if (!entry) return false;
    entry.abortController.abort(new Error('Embedded run aborted'));
    if (entry.handle) await entry.handle.abort();
    return true;
  }

  async steerByConversationId(conversationId: string, text: string): Promise<boolean> {
    const handle = this.getByConversationId(conversationId);
    if (!handle) {
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

export function getEmbeddedRunByConversationId(conversationId: string): EmbeddedRunHandle | undefined {
  return embeddedRunRegistry.getByConversationId(conversationId);
}

export function abortEmbeddedRun(conversationId: string): Promise<boolean> {
  return embeddedRunRegistry.abortByConversationId(conversationId);
}

export function queueEmbeddedSteer(conversationId: string, text: string): Promise<boolean> {
  return embeddedRunRegistry.steerByConversationId(conversationId, text);
}

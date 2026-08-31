import type { AgentSession } from '@earendil-works/pi-coding-agent';

export type EmbeddedRunIdentity = {
  sessionKey: string;
  sessionId: string;
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
  constructor(readonly sessionKey: string, readonly activeRunId: string) {
    super(`Session '${sessionKey}' already has active embedded run '${activeRunId}'`);
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
  private readonly bySessionKey = new Map<string, PendingEmbeddedRun>();

  acquire(identity: EmbeddedRunIdentity): EmbeddedRunLease {
    const active = this.bySessionKey.get(identity.sessionKey);
    if (active) throw new EmbeddedRunConflictError(identity.sessionKey, active.runId);

    const entry: PendingEmbeddedRun = { ...identity, abortController: new AbortController() };
    this.bySessionKey.set(identity.sessionKey, entry);

    return {
      signal: entry.abortController.signal,
      attach: async (session, abort) => {
        entry.handle = { ...identity, session, abort };
        if (entry.abortController.signal.aborted) await abort();
      },
      release: () => {
        if (this.bySessionKey.get(identity.sessionKey) === entry) {
          this.bySessionKey.delete(identity.sessionKey);
        }
      },
    };
  }

  getBySessionKey(sessionKey: string): EmbeddedRunHandle | undefined {
    return this.bySessionKey.get(sessionKey)?.handle;
  }

  async abortBySessionKey(sessionKey: string): Promise<boolean> {
    const entry = this.bySessionKey.get(sessionKey);
    if (!entry) return false;
    entry.abortController.abort(new Error('Embedded run aborted'));
    if (entry.handle) await entry.handle.abort();
    return true;
  }

  async steerBySessionKey(sessionKey: string, text: string): Promise<boolean> {
    const handle = this.getBySessionKey(sessionKey);
    if (!handle) {
      return false;
    }
    await handle.session.steer(text);
    return true;
  }

  size(): number {
    return this.bySessionKey.size;
  }
}

const embeddedRunRegistry = new EmbeddedRunRegistry();

export function acquireEmbeddedRunLease(identity: EmbeddedRunIdentity): EmbeddedRunLease {
  return embeddedRunRegistry.acquire(identity);
}

export function getEmbeddedRunBySessionKey(sessionKey: string): EmbeddedRunHandle | undefined {
  return embeddedRunRegistry.getBySessionKey(sessionKey);
}

export function abortEmbeddedRun(sessionKey: string): Promise<boolean> {
  return embeddedRunRegistry.abortBySessionKey(sessionKey);
}

export function queueEmbeddedSteer(sessionKey: string, text: string): Promise<boolean> {
  return embeddedRunRegistry.steerBySessionKey(sessionKey, text);
}

import type { AgentSession } from '@earendil-works/pi-coding-agent';

import { createLogger } from '../../utils/logger.js';

const log = createLogger('EmbeddedRunRegistry');

export type EmbeddedRunHandle = {
  sessionKey: string;
  sessionId: string;
  runId: string;
  session: AgentSession;
  abort: () => Promise<void>;
};

/**
 * Tracks in-flight embedded agent turns so we can abort/steer them by sessionKey or runId.
 *
 * The previous implementation used two module-level Maps; this class is the supported
 * single-instance state, while {@link defaultEmbeddedRunRegistry} preserves the previous
 * free-function API for callers that have not yet been moved to dependency injection.
 */
export class EmbeddedRunRegistry {
  private readonly bySessionKey = new Map<string, EmbeddedRunHandle>();
  private readonly byRunId = new Map<string, EmbeddedRunHandle>();

  /**
   * Register a new in-flight run. If a run is already registered for the same
   * sessionKey we drop the stale handle (the new run takes ownership). The caller
   * is responsible for aborting the previous run before re-registering if needed —
   * we warn loudly so this does not happen silently.
   */
  register(handle: EmbeddedRunHandle): void {
    const previous = this.bySessionKey.get(handle.sessionKey);
    if (previous && previous !== handle) {
      log.warn(
        {
          sessionKey: handle.sessionKey,
          previousRunId: previous.runId,
          newRunId: handle.runId,
        },
        'Replacing already-registered embedded run for sessionKey (caller did not unregister first)',
      );
      this.byRunId.delete(previous.runId);
    }
    this.bySessionKey.set(handle.sessionKey, handle);
    this.byRunId.set(handle.runId, handle);
  }

  unregister(handle: EmbeddedRunHandle): void {
    const current = this.bySessionKey.get(handle.sessionKey);
    if (current === handle) {
      this.bySessionKey.delete(handle.sessionKey);
    }
    this.byRunId.delete(handle.runId);
  }

  getBySessionKey(sessionKey: string): EmbeddedRunHandle | undefined {
    return this.bySessionKey.get(sessionKey);
  }

  getByRunId(runId: string): EmbeddedRunHandle | undefined {
    return this.byRunId.get(runId);
  }

  async abortBySessionKey(sessionKey: string): Promise<boolean> {
    const handle = this.bySessionKey.get(sessionKey);
    if (!handle) {
      return false;
    }
    await handle.abort();
    return true;
  }

  async steerBySessionKey(sessionKey: string, text: string): Promise<boolean> {
    const handle = this.bySessionKey.get(sessionKey);
    if (!handle) {
      return false;
    }
    await handle.session.steer(text);
    return true;
  }

  /** Test-only helper to drop all registrations without touching live sessions. */
  resetForTest(): void {
    this.bySessionKey.clear();
    this.byRunId.clear();
  }

  size(): number {
    return this.bySessionKey.size;
  }
}

/**
 * Process-wide default registry. Prefer constructing a dedicated `EmbeddedRunRegistry`
 * and injecting it; the module-level singleton stays so the existing free functions
 * keep working until every caller has been migrated.
 */
export const defaultEmbeddedRunRegistry = new EmbeddedRunRegistry();

export function registerEmbeddedRun(handle: EmbeddedRunHandle): void {
  defaultEmbeddedRunRegistry.register(handle);
}

export function unregisterEmbeddedRun(handle: EmbeddedRunHandle): void {
  defaultEmbeddedRunRegistry.unregister(handle);
}

export function getEmbeddedRunBySessionKey(sessionKey: string): EmbeddedRunHandle | undefined {
  return defaultEmbeddedRunRegistry.getBySessionKey(sessionKey);
}

export function getEmbeddedRunByRunId(runId: string): EmbeddedRunHandle | undefined {
  return defaultEmbeddedRunRegistry.getByRunId(runId);
}

export function abortEmbeddedRun(sessionKey: string): Promise<boolean> {
  return defaultEmbeddedRunRegistry.abortBySessionKey(sessionKey);
}

export function queueEmbeddedSteer(sessionKey: string, text: string): Promise<boolean> {
  return defaultEmbeddedRunRegistry.steerBySessionKey(sessionKey, text);
}

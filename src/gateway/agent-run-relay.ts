/**
 * Multicast buffer for a single web agent run so multiple HTTP SSE consumers can
 * attach (initial POST /api/agent and later POST /api/agent/resume) while one
 * background pump drains processDirectStreaming.
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('Gateway:AgentRunRelay');

export type RelayEvent = { type: string } & Record<string, unknown>;

type RunState = {
  sessionKey: string;
  events: RelayEvent[];
  nextSeq: number;
  done: boolean;
  waiters: Array<() => void>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
};

const COMPLETE_TTL_MS = 5 * 60_000;
const MAX_EVENTS = 8000;

export class AgentRunRelay {
  private runs = new Map<string, RunState>();

  ensureRun(runId: string, sessionKey: string): void {
    if (this.runs.has(runId)) return;
    this.runs.set(runId, { sessionKey, events: [], nextSeq: 1, done: false, waiters: [] });
  }

  getSessionKey(runId: string): string | undefined {
    return this.runs.get(runId)?.sessionKey;
  }

  hasRun(runId: string): boolean {
    return this.runs.has(runId);
  }

  publish(runId: string, event: RelayEvent): RelayEvent | undefined {
    const state = this.runs.get(runId);
    if (!state) return undefined;
    const relayed = {
      ...event,
      runId,
      seq: state.nextSeq++,
    };
    if (state.events.length >= MAX_EVENTS) {
      log.warn(
        { runId, max: MAX_EVENTS, droppedType: relayed.type },
        'Relay buffer full; dropping event (resume may miss tool_end/tokens)',
      );
    } else {
      state.events.push(relayed);
    }
    const waiters = state.waiters.splice(0);
    for (const w of waiters) w();
    return relayed;
  }

  complete(runId: string): void {
    const state = this.runs.get(runId);
    if (!state) return;
    state.done = true;
    const waiters = state.waiters.splice(0);
    for (const w of waiters) w();
    if (state.cleanupTimer) clearTimeout(state.cleanupTimer);
    state.cleanupTimer = setTimeout(() => {
      this.runs.delete(runId);
    }, COMPLETE_TTL_MS);
  }

  async *subscribe(runId: string): AsyncGenerator<RelayEvent> {
    const state = this.runs.get(runId);
    if (!state) {
      throw new Error('UNKNOWN_RUN');
    }
    let cursor = 0;
    while (true) {
      while (cursor < state.events.length) {
        yield state.events[cursor++];
      }
      if (state.done) break;
      await new Promise<void>((resolve) => {
        state.waiters.push(resolve);
      });
    }
  }
}

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
  subscriberCount: number;
  compactionWarned: boolean;
  cleanupTimer?: ReturnType<typeof setTimeout>;
};

const COMPLETE_TTL_MS = 5 * 60_000;
const MAX_EVENTS = 8000;
const COMPACT_TO_RATIO = 0.75;
const MAX_MERGED_DELTA_CHARS = 16 * 1024;
const REPLAY_DELTA_TYPES = new Set([
  'assistant_delta',
  'thinking_delta',
  'command_output_delta',
  'review_delta',
]);

function eventSeq(event: RelayEvent | undefined): number | undefined {
  return typeof event.seq === 'number' ? event.seq : undefined;
}

function findEventAtOrAfter(events: RelayEvent[], seq: number): RelayEvent | undefined {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const middleSeq = eventSeq(events[middle]) ?? Number.MAX_SAFE_INTEGER;
    if (middleSeq < seq) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return events[low];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function sameDeltaStream(left: RelayEvent, right: RelayEvent): boolean {
  if (left.type !== right.type || !REPLAY_DELTA_TYPES.has(left.type)) return false;
  const leftPayload = recordValue(left.payload);
  const rightPayload = recordValue(right.payload);
  if (!leftPayload || !rightPayload) return false;
  return ['messageId', 'toolCallId', 'reviewId', 'stream'].every(
    (key) => leftPayload[key] === rightPayload[key],
  );
}

function mergeReplayDelta(events: RelayEvent[], event: RelayEvent): boolean {
  const previous = events.at(-1);
  if (!previous || !sameDeltaStream(previous, event)) return false;
  const previousPayload = recordValue(previous.payload);
  const payload = recordValue(event.payload);
  const previousDelta = previousPayload?.delta;
  const delta = payload?.delta;
  if (typeof previousDelta !== 'string' || typeof delta !== 'string') return false;
  if (previousDelta.length + delta.length > MAX_MERGED_DELTA_CHARS) return false;
  events[events.length - 1] = {
    ...previous,
    payload: { ...previousPayload, delta: previousDelta + delta },
  };
  return true;
}

function compactEvents(events: RelayEvent[], targetSize: number): {
  events: RelayEvent[];
  removedByType: Record<string, number>;
} {
  let remaining = Math.max(0, events.length - targetSize);
  const retained: RelayEvent[] = [];
  const removedByType: Record<string, number> = {};

  for (const event of events) {
    if (remaining > 0 && REPLAY_DELTA_TYPES.has(event.type)) {
      remaining -= 1;
      removedByType[event.type] = (removedByType[event.type] ?? 0) + 1;
      continue;
    }
    retained.push(event);
  }

  if (remaining > 0) {
    for (const event of retained.splice(0, remaining)) {
      removedByType[event.type] = (removedByType[event.type] ?? 0) + 1;
    }
  }
  return { events: retained, removedByType };
}

export class AgentRunRelay {
  private runs = new Map<string, RunState>();

  constructor(private readonly maxEvents = MAX_EVENTS) {
    if (!Number.isInteger(maxEvents) || maxEvents < 2) {
      throw new Error('AgentRunRelay maxEvents must be an integer greater than 1');
    }
  }

  ensureRun(runId: string, sessionKey: string): void {
    if (this.runs.has(runId)) return;
    this.runs.set(runId, {
      sessionKey,
      events: [],
      nextSeq: 1,
      done: false,
      waiters: [],
      subscriberCount: 0,
      compactionWarned: false,
    });
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
    const merged = state.subscriberCount === 0 && mergeReplayDelta(state.events, relayed);
    if (!merged && state.events.length >= this.maxEvents) {
      const targetSize = Math.max(1, Math.floor(this.maxEvents * COMPACT_TO_RATIO));
      const compacted = compactEvents(state.events, targetSize);
      state.events = compacted.events;
      if (!state.compactionWarned) {
        state.compactionWarned = true;
        log.warn(
          {
            runId,
            max: this.maxEvents,
            retained: state.events.length,
            removedByType: compacted.removedByType,
          },
          'Relay replay buffer compacted; old delta events are no longer resumable',
        );
      }
    }
    if (!merged) {
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
    state.subscriberCount += 1;
    try {
      let nextSeq = eventSeq(state.events[0]) ?? state.nextSeq;
      while (true) {
        const earliestSeq = eventSeq(state.events[0]);
        if (earliestSeq !== undefined && nextSeq < earliestSeq) {
          nextSeq = earliestSeq;
        }
        const available = findEventAtOrAfter(state.events, nextSeq);
        if (available) {
          nextSeq = (eventSeq(available) ?? nextSeq) + 1;
          yield available;
          continue;
        }
        if (state.done) break;
        await new Promise<void>((resolve) => {
          state.waiters.push(resolve);
        });
      }
    } finally {
      state.subscriberCount -= 1;
    }
  }
}

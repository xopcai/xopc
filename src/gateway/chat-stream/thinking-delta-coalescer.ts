import type { ChatStreamEvent, ThinkingDeltaEvent } from './protocol.js';

const DEFAULT_WINDOW_MS = 24;
const DEFAULT_MAX_CHARS = 256;

type CoalescerOptions = {
  windowMs?: number;
  maxChars?: number;
};

function isThinkingDelta(event: ChatStreamEvent): event is ThinkingDeltaEvent {
  return event.type === 'thinking_delta';
}

function belongsToSameThinkingStream(left: ThinkingDeltaEvent, right: ThinkingDeltaEvent): boolean {
  return left.runId === right.runId
    && left.sessionKey === right.sessionKey
    && left.payload.messageId === right.payload.messageId;
}

function mergeThinkingDelta(left: ThinkingDeltaEvent, right: ThinkingDeltaEvent): ThinkingDeltaEvent {
  return {
    ...left,
    payload: {
      ...left.payload,
      delta: left.payload.delta + right.payload.delta,
    },
  };
}

async function nextBeforeDeadline<T>(
  next: Promise<IteratorResult<T>>,
  deadlineAt: number,
): Promise<{ kind: 'next'; result: IteratorResult<T> } | { kind: 'timeout' }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      next.then((result) => ({ kind: 'next' as const, result })),
      new Promise<{ kind: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), Math.max(0, deadlineAt - Date.now()));
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function* coalesceThinkingDeltas(
  source: AsyncIterable<ChatStreamEvent>,
  options: CoalescerOptions = {},
): AsyncGenerator<ChatStreamEvent> {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error('thinking delta coalescer windowMs must be greater than zero');
  }
  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    throw new Error('thinking delta coalescer maxChars must be a positive integer');
  }

  const iterator = source[Symbol.asyncIterator]();
  const readNext = () => {
    const result = iterator.next();
    // Prefetch may reject while the consumer is paused; awaiting it still propagates the error.
    void result.catch(() => {});
    return result;
  };
  let next = readNext();
  let pending: ThinkingDeltaEvent | undefined;
  let deadlineAt = 0;

  try {
    while (true) {
      if (!pending) {
        const result = await next;
        if (result.done) break;
        next = readNext();
        if (!isThinkingDelta(result.value)) {
          yield result.value;
          continue;
        }
        pending = result.value;
        deadlineAt = Date.now() + windowMs;
        if (pending.payload.delta.length >= maxChars) {
          yield pending;
          pending = undefined;
        }
        continue;
      }

      const task = await nextBeforeDeadline(next, deadlineAt);
      if (task.kind === 'timeout') {
        yield pending;
        pending = undefined;
        continue;
      }

      const result = task.result;
      if (result.done) {
        yield pending;
        pending = undefined;
        break;
      }
      next = readNext();
      const event = result.value;
      if (!isThinkingDelta(event) || !belongsToSameThinkingStream(pending, event)) {
        yield pending;
        pending = undefined;
        if (isThinkingDelta(event)) {
          pending = event;
          deadlineAt = Date.now() + windowMs;
          if (pending.payload.delta.length >= maxChars) {
            yield pending;
            pending = undefined;
          }
        } else {
          yield event;
        }
        continue;
      }

      pending = mergeThinkingDelta(pending, event);
      if (pending.payload.delta.length >= maxChars) {
        yield pending;
        pending = undefined;
      }
    }
  } catch (error) {
    if (pending) {
      yield pending;
      pending = undefined;
    }
    throw error;
  } finally {
    await iterator.return?.();
  }
}

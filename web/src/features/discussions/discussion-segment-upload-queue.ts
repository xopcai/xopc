import type { DiscussionTranscript } from './discussion-types';

const MAX_RETRY_DELAY_MS = 30_000;

type UploadError = Error & { retryAfterMs?: number; status?: number };

export interface DiscussionSegmentUploadQueueDeps<TSegment> {
  list: (draftId: string) => Promise<TSegment[]>;
  upload: (discussionId: string, segment: TSegment) => Promise<DiscussionTranscript>;
  remove: (draftId: string, segment: TSegment) => Promise<void>;
  onTranscript?: (transcript: DiscussionTranscript) => void;
  onPendingCount?: (count: number) => void;
}

export interface DiscussionSegmentUploadTarget {
  draftId: string;
  discussionId: string;
}

function retryDelay(error: unknown, attempt: number): number {
  const requested = (error as UploadError | undefined)?.retryAfterMs;
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, requested));
  }
  return Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** Math.min(attempt, 5));
}

function isRetryable(error: unknown): boolean {
  const status = (error as UploadError | undefined)?.status;
  return typeof status !== 'number' || status === 408 || status === 429 || status >= 500;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Drains the durable IndexedDB queue in sequence order until it is empty or cancelled. */
export async function drainDiscussionSegmentUploadQueue<TSegment>(
  target: DiscussionSegmentUploadTarget,
  deps: DiscussionSegmentUploadQueueDeps<TSegment>,
  signal: AbortSignal,
): Promise<void> {
  let attempt = 0;
  while (!signal.aborted) {
    const pending = await deps.list(target.draftId);
    deps.onPendingCount?.(pending.length);
    const segment = pending[0];
    if (!segment) return;
    try {
      const transcript = await deps.upload(target.discussionId, segment);
      await deps.remove(target.draftId, segment);
      deps.onTranscript?.(transcript);
      attempt = 0;
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      if (!isRetryable(error)) throw error;
      await wait(retryDelay(error, attempt), signal);
      attempt += 1;
    }
  }
}

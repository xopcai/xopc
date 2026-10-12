export type ResponseLatencySnapshot = {
  runId: string;
  firstTextMs?: number;
  firstVisibleMs?: number;
  firstSentenceMs?: number;
  firstRenderLagMs?: number;
  status?: string;
};

type Timing = ResponseLatencySnapshot & { startedAt: number; firstTextAt?: number };
const MAX_TRACKED_RESPONSES = 40;
const pending = new Map<string, number>();
const timings = new Map<string, Timing>();

function bound<T>(map: Map<string, T>): void {
  if (map.size > MAX_TRACKED_RESPONSES) map.delete(map.keys().next().value!);
}

/** Local monotonic timings only; no message text or cross-machine clock subtraction. */
export function beginResponseLatency(conversationId: string): number {
  const startedAt = performance.now();
  pending.set(conversationId, startedAt);
  bound(pending);
  return startedAt;
}

export function discardPendingResponseLatency(conversationId: string, startedAt: number): void {
  if (pending.get(conversationId) === startedAt) pending.delete(conversationId);
}

export function bindResponseLatency(conversationId: string, runId: string): void {
  if (timings.has(runId)) return;
  const startedAt = pending.get(conversationId);
  // Resuming history must not be measured as a fresh request.
  if (startedAt === undefined) return;
  pending.delete(conversationId);
  timings.set(runId, { runId, startedAt });
  bound(timings);
}

export function recordResponseText(runId: string): void {
  const timing = timings.get(runId);
  if (!timing || timing.firstTextAt !== undefined) return;
  timing.firstTextAt = performance.now();
  timing.firstTextMs = timing.firstTextAt - timing.startedAt;
}

export function hasCompleteOpeningSentence(text: string, terminal = false): boolean {
  // This is a timing heuristic, never a transport or Markdown splitter.
  const opening = text.trimStart();
  if (!opening || /^(?:```|~~~|\||#{1,6}\s|[-*+]\s|\d+[.)]\s)/u.test(opening)) return false;
  return /[。！？]/u.test(opening) || /[!?](?:[”’"')）\]]|\s|$)/u.test(opening)
    || /(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|vs|etc))\.[”’"')\]]*\s/u.test(opening)
    // A trailing period may still be the start of a streamed decimal.
    || (terminal && /(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|vs|etc))\.[”’"')\]]*$/u.test(opening));
}

export function recordResponseVisible(runId: string, text: string): void {
  const timing = timings.get(runId);
  if (!timing || timing.firstTextAt === undefined || !text.trim() || text.trim() === 'NO_REPLY') return;
  const timestamp = performance.now();
  if (timing.firstVisibleMs === undefined) {
    timing.firstVisibleMs = timestamp - timing.startedAt;
    timing.firstRenderLagMs = timestamp - timing.firstTextAt;
  }
  if (timing.firstSentenceMs === undefined && hasCompleteOpeningSentence(text, timing.status === 'success')) {
    timing.firstSentenceMs = timestamp - timing.startedAt;
  }
}

export function finishResponseLatency(runId: string, status: string): void {
  const timing = timings.get(runId);
  if (timing) timing.status = status;
}

export function getResponseLatencyMetrics(): ResponseLatencySnapshot[] {
  return Array.from(timings.values(), ({ startedAt: _startedAt, firstTextAt: _firstTextAt, ...snapshot }) => snapshot);
}

export function resetResponseLatencyMetrics(): void {
  pending.clear();
  timings.clear();
}

declare global {
  interface Window {
    __xopcResponseLatencyMetrics?: typeof getResponseLatencyMetrics;
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__xopcResponseLatencyMetrics = getResponseLatencyMetrics;
}

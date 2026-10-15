import { graphemeCommitBoundary } from '@/features/chat/rendering/markdown/text-segments';

export type StreamingMarkdownTailKind =
  | 'plain'
  | 'long_text'
  | 'list'
  | 'table'
  | 'code';

const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/m;
const LIST_ITEM_RE = /^\s{0,3}(?:[-+*]|\d+[.)])\s+/m;
const FENCE_RE = /^\s{0,3}```/gm;

export function classifyStreamingMarkdownTail(
  tail: string,
): StreamingMarkdownTailKind {
  const fenceCount = tail.match(FENCE_RE)?.length ?? 0;
  if (fenceCount % 2 === 1) return 'code';
  if (TABLE_SEPARATOR_RE.test(tail)) return 'table';
  if (LIST_ITEM_RE.test(tail)) return 'list';
  if (tail.length >= 4_096) return 'long_text';
  return 'plain';
}

const BASE_INTERVAL_MS: Record<StreamingMarkdownTailKind, number> = {
  plain: 50,
  long_text: 50,
  list: 50,
  table: 72,
  code: 64,
};

export function streamingMarkdownCommitIntervalMs({
  tailKind,
  latestParseMs,
}: {
  tailKind: StreamingMarkdownTailKind;
  latestParseMs: number;
}): number {
  const base = BASE_INTERVAL_MS[tailKind];
  if (!Number.isFinite(latestParseMs) || latestParseMs <= 16) return base;
  return Math.min(120, Math.max(base, Math.ceil(latestParseMs * 2)));
}

/** Smooth arrival-rate samples and drain bursts gradually without a timed full flush. */
export class AdaptiveStreamingMarkdownPacer {
  private targetLength: number;
  private lastArrivalAt: number | null = null;
  private lastDrainAt: number | null = null;
  private arrivalRate = 40;
  private outputRate = 40;
  private carry = 0;

  constructor(initialLength: number) {
    this.targetLength = initialLength;
  }

  reset(length: number): void {
    this.targetLength = length;
    this.lastArrivalAt = null;
    this.lastDrainAt = null;
    this.arrivalRate = 40;
    this.outputRate = 40;
    this.carry = 0;
  }

  observe(length: number, now: number): void {
    const added = length - this.targetLength;
    if (added <= 0) return;
    const sample = this.lastArrivalAt === null ? added
      : added * 1000 / Math.max(10, now - this.lastArrivalAt);
    this.arrivalRate = Math.max(1, this.arrivalRate * 0.9 + sample * 0.1);
    this.targetLength = length;
    this.lastArrivalAt = now;
    this.lastDrainAt ??= now;
  }

  nextLength(visibleLength: number, content: string, now: number): number {
    const backlog = content.length - visibleLength;
    if (backlog <= 0) return content.length;
    const elapsedMs = Math.max(0, Math.min(120, now - (this.lastDrainAt ?? now)));
    this.lastDrainAt = now;
    // Keep a small tail moving while accelerating smoothly when a burst builds up.
    const targetRate = Math.max(20, this.arrivalRate, backlog / 0.6);
    this.outputRate += (targetRate - this.outputRate) * (1 - Math.exp(-elapsedMs / 120));
    const credit = this.carry + this.outputRate * elapsedMs / 1000;
    const length = graphemeCommitBoundary(content, Math.min(content.length, visibleLength + Math.floor(credit)));
    this.carry = Math.max(0, credit - (length - visibleLength));
    if (length === content.length) {
      this.lastDrainAt = null;
      this.carry = 0;
    }
    return length;
  }
}

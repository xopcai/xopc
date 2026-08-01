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
  plain: 32,
  long_text: 48,
  list: 40,
  table: 72,
  code: 64,
};

const FIRST_COMMIT_INTERVAL_MS = 48;
const TARGET_COMMIT_COUNT = 16;
const MIN_COMMIT_SIZE = 6;
const MAX_COMMIT_SIZE = 512;

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

export function streamingMarkdownCommitDelayMs({
  intervalMs,
  elapsedMs,
  firstCommit,
}: {
  intervalMs: number;
  elapsedMs: number;
  firstCommit: boolean;
}): number {
  if (firstCommit) return Math.max(FIRST_COMMIT_INTERVAL_MS, intervalMs);
  return Math.max(0, intervalMs - elapsedMs);
}

export function nextStreamingMarkdownCommitLength({
  visibleLength,
  pendingContent,
}: {
  visibleLength: number;
  pendingContent: string;
}): number {
  if (visibleLength >= pendingContent.length) return pendingContent.length;
  const commitSize = Math.min(
    MAX_COMMIT_SIZE,
    Math.max(MIN_COMMIT_SIZE, Math.ceil(pendingContent.length / TARGET_COMMIT_COUNT)),
  );
  let nextLength = Math.min(pendingContent.length, visibleLength + commitSize);
  const previousCodeUnit = pendingContent.charCodeAt(nextLength - 1);
  const nextCodeUnit = pendingContent.charCodeAt(nextLength);
  if (
    previousCodeUnit >= 0xd800 && previousCodeUnit <= 0xdbff
    && nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff
  ) {
    nextLength += 1;
  }
  return nextLength;
}

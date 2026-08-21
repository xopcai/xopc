import { resolveToolActivity, type ToolActivity } from '@xopcai/gateway-contract';

import type { Message, MessageContent, ReviewContent, ToolUseContent } from '@/features/chat/messages/messages.types';

/** Pi / wire format may use `thinking` on blocks; UI streaming uses `text`. */
function thinkingBlockVisibleText(b: MessageContent): string {
  if (b.type !== 'thinking') {
    return '';
  }
  const x = b as { text?: string; thinking?: string };
  const raw =
    typeof x.text === 'string' && x.text.length > 0
      ? x.text
      : typeof x.thinking === 'string'
        ? x.thinking
        : '';
  return raw.trim();
}

/** True if the assistant bubble has something worth keeping (text, thinking, or tools). */
export function hasRenderableAssistantContent(msg: Message): boolean {
  if (msg.role !== 'assistant') {
    return false;
  }
  for (const b of msg.content) {
    if (b.type === 'text' && (b.text || '').trim().length > 0) {
      return true;
    }
    if (b.type === 'thinking' && thinkingBlockVisibleText(b).length > 0) {
      return true;
    }
    if (b.type === 'tool_use') {
      return true;
    }
    if (b.type === 'review') {
      return true;
    }
  }
  return false;
}

/**
 * Return an assistant message suitable for in-place streaming mutations.
 *
 * **Important:** the returned message always owns a *fresh* `content` array
 * (shallow-copied from the previous one when reusing an existing message).
 * React StrictMode (dev) invokes `setState` updaters twice with the *same*
 * `prev` reference; without this copy the second invocation would mutate the
 * array that was already pushed-to by the first invocation, duplicating
 * tool_use / thinking / text blocks.
 */
export function ensureAssistantMessage(msg: Message | null | undefined, timestamp: number): Message {
  if (msg && msg.role === 'assistant') {
    return { ...msg, content: [...msg.content] };
  }
  return { role: 'assistant', content: [], timestamp };
}

/**
 * Clone message so memoized children see new references after in-place streaming mutations
 * to nested `content` / `attachments`.
 */
export function cloneMessageForRender(msg: Message): Message {
  return {
    ...msg,
    content: msg.content.map((b) => ({ ...b })),
    attachments: msg.attachments ? msg.attachments.map((a) => ({ ...a })) : undefined,
  };
}

/**
 * Resume/reconnect can replay part of a stream; append only the non-overlapping suffix.
 * Example: base="abc", incoming="bcdef" => "abcdef", incoming="abc" => unchanged.
 */
function appendWithOverlap(base: string, incoming: string): string {
  if (!incoming) return base;
  if (!base) return incoming;
  if (base.endsWith(incoming)) return base;
  const max = Math.min(base.length, incoming.length, 512);
  for (let overlap = max; overlap > 0; overlap--) {
    if (base.slice(-overlap) === incoming.slice(0, overlap)) {
      return base + incoming.slice(overlap);
    }
  }
  return base + incoming;
}

function closeStreamingThinkingIfAny(content: MessageContent[]): void {
  const last = content[content.length - 1];
  if (last?.type === 'thinking' && last.streaming) {
    last.streaming = false;
  }
}

/** Start a new reasoning segment (e.g. run `thinking` with status `started`). */
export function startThinkingSegment(content: MessageContent[]): void {
  const last = content[content.length - 1];
  if (last?.type === 'thinking' && last.streaming) {
    return;
  }
  content.push({ type: 'thinking', text: '', streaming: true });
}

/** Append or replace text in the current thinking block, creating one if needed. */
export function appendThinkingDelta(content: MessageContent[], text: string, isDelta: boolean): void {
  const last = content[content.length - 1];
  if (last?.type === 'thinking') {
    if (isDelta) {
      last.text = appendWithOverlap(last.text || '', text);
    } else {
      last.text = text;
    }
    last.streaming = true;
    return;
  }
  content.push({ type: 'thinking', text: isDelta ? text : text, streaming: true });
}

/** Mark the last open thinking segment as no longer streaming (e.g. `thinking_end`). */
export function finalizeStreamingThinking(content: MessageContent[]): void {
  closeStreamingThinkingIfAny(content);
  for (const b of content) {
    if (b.type === 'thinking' && typeof b.text === 'string') {
      b.text = b.text.trim();
    }
  }
}

/**
 * Mark any `tool_use` still `running` as `done` when the turn commits.
 * Matches persisted session after refresh: run `tool_end` can be missed (parse edge cases)
 * or `toolName` may not match `completeTool`'s strict equality vs `tool_start`.
 */
export function finalizeRunningTools(content: MessageContent[]): void {
  for (const b of content) {
    if (b.type === 'tool_use' && b.status === 'running') {
      b.status = 'done';
    }
  }
}

function toolNameMatches(stored: string, fromEvent: string): boolean {
  return stored.trim().toLowerCase() === fromEvent.trim().toLowerCase();
}

export function appendTextDelta(content: MessageContent[], delta: string, segmentId?: string): void {
  closeStreamingThinkingIfAny(content);

  const last = content[content.length - 1];
  if (last?.type === 'text' && last.segmentId === segmentId) {
    last.text = appendWithOverlap(last.text || '', delta);
    return;
  }
  content.push({
    type: 'text',
    text: delta,
    ...(segmentId ? { segmentId, presentation: 'pending' as const } : {}),
  });
}

export function finishTextSegment(
  content: MessageContent[],
  segmentId: string,
  presentation: 'narration' | 'answer',
): void {
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i];
    if (block.type === 'text' && block.segmentId === segmentId) {
      block.presentation = presentation;
      return;
    }
  }
}

function normalizeReview(raw: unknown): ReviewContent | null {
  const rec = asRecord(raw);
  if (!rec || rec.type !== 'review') return null;
  const findings = Array.isArray(rec.findings) ? rec.findings : [];
  const review: ReviewContent = {
    type: 'review',
    target: typeof rec.target === 'string' ? rec.target : 'working tree changes',
    summary: typeof rec.summary === 'string' ? rec.summary : '',
    findings: findings
      .map((item): ReviewContent['findings'][number] | null => {
        const f = asRecord(item);
        if (!f) return null;
        const priority = f.priority === 0 || f.priority === 1 || f.priority === 2 || f.priority === 3 ? f.priority : 2;
        const title = typeof f.title === 'string' ? f.title : '';
        const body = typeof f.body === 'string' ? f.body : '';
        if (!title && !body) return null;
        const finding: ReviewContent['findings'][number] = {
          title,
          body,
          priority,
        };
        if (typeof f.confidenceScore === 'number') finding.confidenceScore = f.confidenceScore;
        if (typeof f.filePath === 'string') finding.filePath = f.filePath;
        if (typeof f.lineStart === 'number') finding.lineStart = f.lineStart;
        if (typeof f.lineEnd === 'number') finding.lineEnd = f.lineEnd;
        return finding;
      })
      .filter((item): item is ReviewContent['findings'][number] => item != null),
    overallCorrectness:
      rec.overallCorrectness === 'patch is correct' || rec.overallCorrectness === 'patch is incorrect'
        ? rec.overallCorrectness
        : 'unknown',
    overallExplanation: typeof rec.overallExplanation === 'string' ? rec.overallExplanation : '',
  };
  if (typeof rec.overallConfidenceScore === 'number') review.overallConfidenceScore = rec.overallConfidenceScore;
  if (typeof rec.generatedAt === 'number') review.generatedAt = rec.generatedAt;
  if (rec.source === 'model' || rec.source === 'local') review.source = rec.source;
  return review;
}

export function appendReview(content: MessageContent[], rawReview: unknown): void {
  closeStreamingThinkingIfAny(content);
  const review = normalizeReview(rawReview);
  if (!review) return;
  const existingIndex = content.findIndex((b) => b.type === 'review' && b.target === review.target);
  if (existingIndex >= 0) {
    const existing = content[existingIndex];
    if (!existing || existing.type !== 'review') return;
    content[existingIndex] = {
      ...review,
      reviewId: existing.reviewId,
      status: existing.status === 'error' ? 'error' : 'complete',
      analysisMarkdown: existing.analysisMarkdown,
      errorMessage: existing.errorMessage,
    };
    return;
  }
  content.push(review);
}

/** Give an interrupted isolated review a terminal user-facing state. */
export function finalizeRunningReviews(content: MessageContent[]): void {
  for (const block of content) {
    if (block.type !== 'review') continue;
    if (block.status !== 'preparing' && block.status !== 'reviewing') continue;
    block.status = 'error';
    block.errorMessage ??= 'The review stream ended before a conclusion was returned.';
  }
}

export function startReview(
  content: MessageContent[],
  review: { reviewId: string; target: string; stage: 'preparing' | 'reviewing' },
): void {
  closeStreamingThinkingIfAny(content);
  const existing = content.find((b): b is ReviewContent => b.type === 'review' && b.reviewId === review.reviewId);
  if (existing) {
    existing.target = review.target || existing.target;
    existing.status = review.stage;
    return;
  }
  content.push({
    type: 'review',
    reviewId: review.reviewId,
    target: review.target || 'working tree changes',
    summary: '',
    findings: [],
    overallCorrectness: 'unknown',
    overallExplanation: '',
    status: review.stage,
  });
}

export function appendReviewDelta(content: MessageContent[], reviewId: string, delta: string): void {
  if (!delta) return;
  const review = content.find((b): b is ReviewContent => b.type === 'review' && b.reviewId === reviewId);
  if (!review) return;
  review.status = 'reviewing';
  review.analysisMarkdown = appendWithOverlap(review.analysisMarkdown ?? '', delta);
}

export function finishReview(
  content: MessageContent[],
  reviewId: string,
  status: 'complete' | 'error',
  errorMessage?: string,
): void {
  const review = content.find((b): b is ReviewContent => b.type === 'review' && b.reviewId === reviewId);
  if (!review) return;
  review.status = status;
  review.errorMessage = status === 'error' ? errorMessage : undefined;
}

export function appendToolStart(
  content: MessageContent[],
  toolName: string,
  args: unknown,
  toolCallId: string | undefined,
  startedAt: number,
  activity?: ToolActivity,
): void {
  closeStreamingThinkingIfAny(content);

  const block: ToolUseContent = {
    type: 'tool_use',
    id: crypto.randomUUID(),
    toolCallId,
    name: toolName,
    activity: activity ?? resolveToolActivity(toolName, 'running'),
    input: args,
    status: 'running',
    startedAt,
  };
  content.push(block);
}

export function completeTool(
  content: MessageContent[],
  toolName: string,
  isError: boolean,
  result: unknown,
  toolCallId: string | undefined,
  completedAt: number,
  activity?: ToolActivity,
): void {
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i];
    if (b.type !== 'tool_use' || b.status !== 'running') continue;
    if (toolCallId && b.toolCallId !== toolCallId && b.id !== toolCallId) continue;
    if (!toolCallId && !toolNameMatches(b.name, toolName)) continue;
    b.status = isError ? 'error' : 'done';
    b.result = result;
    b.activity = activity ?? resolveToolActivity(toolName, isError ? 'failed' : 'completed', result);
    b.completedAt = completedAt;
    if (b.startedAt != null) {
      b.durationMs = Math.max(0, completedAt - b.startedAt);
    }
    return;
  }
}

/**
 * Write structured `details` onto a still-running tool_use block. Matches by
 * toolCallId when provided (most reliable), otherwise falls back to the most
 * recent running block with the same tool name. Silently no-ops when no
 * matching block exists — the realtime stream can race ahead of the tool_start the
 * resume path missed, and we'd rather drop an update than crash.
 */
export function updateToolDetails(
  content: MessageContent[],
  toolName: string,
  toolCallId: string | undefined,
  details: unknown,
): void {
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i];
    if (b.type !== 'tool_use') continue;
    if (b.status !== 'running') continue;
    if (toolCallId && b.toolCallId === toolCallId) {
      b.details = mergeToolDetails(b.details, details);
      return;
    }
    if (!toolCallId && toolNameMatches(b.name, toolName)) {
      b.details = mergeToolDetails(b.details, details);
      return;
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mergeToolDetails(previous: unknown, next: unknown): unknown {
  const incoming = asRecord(next);
  if (typeof incoming?.textDelta === 'string') {
    const current = asRecord(previous) ?? {};
    return {
      ...current,
      text: appendWithOverlap(String(current.text ?? ''), incoming.textDelta),
    };
  }
  if (incoming?.kind !== 'command_output_delta') {
    return next;
  }
  const current = asRecord(previous) ?? {};
  const stream = incoming.stream === 'stderr' ? 'stderr' : 'stdout';
  const delta = typeof incoming.delta === 'string' ? incoming.delta : '';
  const stdout = stream === 'stdout' ? `${String(current.stdout ?? '')}${delta}` : String(current.stdout ?? '');
  const stderr = stream === 'stderr' ? `${String(current.stderr ?? '')}${delta}` : String(current.stderr ?? '');
  return {
    ...current,
    command: typeof incoming.command === 'string' ? incoming.command : current.command,
    cwd: typeof incoming.cwd === 'string' ? incoming.cwd : current.cwd,
    stdout,
    stderr,
    aggregatedOutput: `${String(current.aggregatedOutput ?? '')}${delta}`,
  };
}

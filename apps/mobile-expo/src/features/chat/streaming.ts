/**
 * Streaming helpers for building assistant messages from realtime run events.
 * Ported from web/src/features/chat/streaming.ts — kept in sync.
 */

import type { Message, MessageContent, ReviewContent, ToolUseContent } from './messages.types';

/** True if the assistant bubble has something worth keeping (text, thinking, or tools). */
export function hasRenderableAssistantContent(msg: Message): boolean {
  if (msg.role !== 'assistant') return false;
  for (const b of msg.content) {
    if (b.type === 'text' && (b.text || '').trim().length > 0) return true;
    if (b.type === 'thinking' && (b.text || '').trim().length > 0) return true;
    if (b.type === 'tool_use') return true;
    if (b.type === 'review') return true;
    if (b.type === 'audio' && Boolean(b.uri || b.workspaceRelativePath)) return true;
  }
  return false;
}

/**
 * Return an assistant message suitable for in-place streaming mutations.
 * Always owns a *fresh* `content` array (shallow-copied from prev).
 */
export function ensureAssistantMessage(msg: Message | null | undefined, timestamp: number): Message {
  if (msg && msg.role === 'assistant') {
    return { ...msg, content: [...msg.content] };
  }
  return { id: `stream-${timestamp}`, role: 'assistant', content: [], timestamp };
}

/** Clone message so memoized children see new references after streaming mutations. */
export function cloneMessageForRender(msg: Message): Message {
  return {
    ...msg,
    content: msg.content.map((b) => ({ ...b })),
    attachments: msg.attachments ? msg.attachments.map((a) => ({ ...a })) : undefined,
  };
}

/**
 * Resume/reconnect can replay part of a stream; append only the non-overlapping suffix.
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

/** Start a new reasoning segment. */
export function startThinkingSegment(content: MessageContent[]): void {
  const last = content[content.length - 1];
  if (last?.type === 'thinking' && last.streaming) return;
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
  content.push({ type: 'thinking', text, streaming: true });
}

/** Mark the last open thinking segment as no longer streaming. */
export function finalizeStreamingThinking(content: MessageContent[]): void {
  closeStreamingThinkingIfAny(content);
  for (const b of content) {
    if (b.type === 'thinking' && typeof b.text === 'string') {
      b.text = b.text.trim();
    }
  }
}

/** Mark any `tool_use` still `running` as `done` when the turn commits. */
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function appendOutput(existing: unknown, delta: string): string {
  return `${typeof existing === 'string' ? existing : ''}${delta}`;
}

function commandResultFromDetails(details: Record<string, unknown>): unknown {
  const output = typeof details.aggregatedOutput === 'string' ? details.aggregatedOutput : '';
  return {
    content: output ? [{ type: 'text', text: output }] : [],
    details,
  };
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
    content[existingIndex] = review;
    return;
  }
  content.push(review);
}

export function appendToolStart(
  content: MessageContent[],
  toolName: string,
  args: unknown,
  toolCallId?: string,
): void {
  closeStreamingThinkingIfAny(content);
  const block: ToolUseContent = {
    type: 'tool_use',
    id: toolCallId || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    toolCallId,
    name: toolName,
    input: args,
    status: 'running',
  };
  content.push(block);
}

export function completeTool(
  content: MessageContent[],
  toolName: string,
  isError: boolean,
  result?: unknown,
  toolCallId?: string,
): void {
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i];
    if (b.type !== 'tool_use' || b.status !== 'running') continue;
    if (toolCallId && b.toolCallId !== toolCallId && b.id !== toolCallId) continue;
    if (!toolCallId && !toolNameMatches(b.name, toolName)) continue;
    b.status = isError ? 'error' : 'done';
    b.result = result;
    return;
  }
}

export function appendCommandOutputDelta(
  content: MessageContent[],
  toolCallId: string,
  stream: 'stdout' | 'stderr',
  delta: string,
): void {
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i];
    if (b.type !== 'tool_use' || b.name !== 'exec_command') continue;
    if (b.toolCallId !== toolCallId && b.id !== toolCallId) continue;
    const prev = asRecord(b.details);
    const next = {
      ...prev,
      stdout: stream === 'stdout' ? appendOutput(prev.stdout, delta) : prev.stdout,
      stderr: stream === 'stderr' ? appendOutput(prev.stderr, delta) : prev.stderr,
      aggregatedOutput: appendOutput(prev.aggregatedOutput, delta),
    };
    b.details = next;
    b.result = commandResultFromDetails(next);
    return;
  }
}

export function completeCommand(
  content: MessageContent[],
  payload: {
    toolCallId: string;
    command: string;
    cwd?: string;
    exitCode: number | null;
    durationMs?: number;
    timedOut?: boolean;
    truncated?: boolean;
  },
): void {
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i];
    if (b.type !== 'tool_use' || b.name !== 'exec_command') continue;
    if (b.toolCallId !== payload.toolCallId && b.id !== payload.toolCallId) continue;
    const details = {
      ...asRecord(b.details),
      command: payload.command,
      cwd: payload.cwd,
      exitCode: payload.exitCode,
      durationMs: payload.durationMs,
      timedOut: payload.timedOut === true,
      truncated: payload.truncated === true,
    };
    b.status = 'done';
    b.details = details;
    b.result = commandResultFromDetails(details);
    return;
  }
}

export function completePatchApplied(
  content: MessageContent[],
  payload: {
    toolCallId: string;
    changes: unknown[];
    diff: string;
    added: number;
    removed: number;
  },
): void {
  const details = {
    changes: payload.changes,
    diff: payload.diff,
    added: payload.added,
    removed: payload.removed,
  };
  const result = {
    content: payload.diff ? [{ type: 'text', text: payload.diff }] : [],
    details,
  };
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i];
    if (b.type !== 'tool_use' || b.name !== 'apply_patch') continue;
    if (b.toolCallId !== payload.toolCallId && b.id !== payload.toolCallId) continue;
    b.status = 'done';
    b.details = details;
    b.result = result;
    return;
  }
  content.push({
    type: 'tool_use',
    id: payload.toolCallId,
    toolCallId: payload.toolCallId,
    name: 'apply_patch',
    status: 'done',
    details,
    result,
  });
}

export function updateToolDetails(
  content: MessageContent[],
  toolName: string,
  toolCallId: string | undefined,
  details: unknown,
): void {
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i];
    if (b.type !== 'tool_use' || b.status !== 'running') continue;
    if (toolCallId && b.toolCallId !== toolCallId && b.id !== toolCallId) continue;
    if (!toolCallId && !toolNameMatches(b.name, toolName)) continue;
    b.details = {
      ...asRecord(b.details),
      ...asRecord(details),
    };
    return;
  }
}

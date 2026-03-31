import type { Message, MessageContent, ToolUseContent } from '@/features/chat/messages.types';

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
  }
  return false;
}

export function ensureAssistantMessage(msg: Message | null | undefined, timestamp: number): Message {
  if (msg && msg.role === 'assistant') {
    return msg;
  }
  return { role: 'assistant', content: [], timestamp };
}

/**
 * Clone message so Lit child components (e.g. message-bubble) see a new `message` reference
 * after in-place streaming mutations. Without this, @property message skips re-render when
 * only nested content changes.
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

/** Start a new reasoning segment (e.g. SSE `thinking` with status `started`). */
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
 * Matches persisted session after refresh: SSE `tool_end` can be missed (parse edge cases)
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

export function appendTextDelta(content: MessageContent[], delta: string): void {
  closeStreamingThinkingIfAny(content);

  const last = content[content.length - 1];
  if (last?.type === 'text') {
    last.text = appendWithOverlap(last.text || '', delta);
    return;
  }
  content.push({ type: 'text', text: delta });
}

export function appendToolStart(content: MessageContent[], toolName: string, args: unknown): void {
  closeStreamingThinkingIfAny(content);

  const block: ToolUseContent = {
    type: 'tool_use',
    id: crypto.randomUUID(),
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
  result?: string,
): void {
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i];
    if (
      b.type === 'tool_use' &&
      b.status === 'running' &&
      toolNameMatches(b.name, toolName)
    ) {
      b.status = isError ? 'error' : 'done';
      b.result = result;
      return;
    }
  }
}

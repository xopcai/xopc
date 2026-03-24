import type { Message, MessageContent, ToolUseContent } from '@/features/chat/messages.types';

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
      last.text = (last.text || '') + text;
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

export function appendTextDelta(content: MessageContent[], delta: string): void {
  closeStreamingThinkingIfAny(content);

  const last = content[content.length - 1];
  if (last?.type === 'text') {
    last.text = (last.text || '') + delta;
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
    if (b.type === 'tool_use' && b.name === toolName && b.status === 'running') {
      b.status = isError ? 'error' : 'done';
      b.result = result;
      return;
    }
  }
}

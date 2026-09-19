import { resolveToolActivity, type ToolActivity } from '@xopcai/gateway-contract';

import type {
  BrowserChatMessage,
  BrowserMessageBlock,
  BrowserThinkingBlock,
  BrowserToolBlock,
} from './chat-message-model';

export type BrowserRunEvent = {
  event: string;
  payload: Record<string, unknown>;
  runId: string;
  timestamp: number;
};

function appendWithOverlap(base: string, incoming: string): string {
  if (!incoming || base.endsWith(incoming)) return base;
  const max = Math.min(base.length, incoming.length, 512);
  for (let length = max; length > 0; length -= 1) {
    if (base.slice(-length) === incoming.slice(0, length)) {
      return base + incoming.slice(length);
    }
  }
  return base + incoming;
}

function closeThinking(blocks: BrowserMessageBlock[]): void {
  const last = blocks.at(-1);
  if (last?.type === 'thinking') last.streaming = false;
}

function mergeDetails(previous: unknown, next: unknown): unknown {
  if (!next || typeof next !== 'object' || Array.isArray(next)) return next;
  const incoming = next as Record<string, unknown>;
  if (typeof incoming.textDelta !== 'string') return next;
  const current = previous && typeof previous === 'object' && !Array.isArray(previous)
    ? previous as Record<string, unknown>
    : {};
  return { ...current, text: appendWithOverlap(String(current.text ?? ''), incoming.textDelta) };
}

function activity(value: unknown): ToolActivity | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as ToolActivity;
}

function toolId(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.toolCallId === 'string' && payload.toolCallId ? payload.toolCallId : fallback;
}

export function createStreamingMessage(runId: string, timestamp = Date.now()): BrowserChatMessage {
  return { id: `stream:${runId}`, role: 'assistant', blocks: [], timestamp };
}

export function reduceRunEvent(
  current: BrowserChatMessage | undefined,
  input: BrowserRunEvent,
): BrowserChatMessage {
  const message = current
    ? { ...current, blocks: current.blocks.map((block) => ({ ...block })) }
    : createStreamingMessage(input.runId, input.timestamp);
  const { event, payload } = input;

  if (event === 'assistant_delta' && typeof payload.delta === 'string' && payload.delta) {
    closeThinking(message.blocks);
    const messageId = typeof payload.messageId === 'string' ? payload.messageId : undefined;
    const last = message.blocks.at(-1);
    if (last?.type === 'text' && last.messageId === messageId) {
      last.text = appendWithOverlap(last.text, payload.delta);
    } else {
      message.blocks.push({ type: 'text', text: payload.delta, ...(messageId ? { messageId } : {}) });
    }
  } else if (event === 'thinking_delta' && typeof payload.delta === 'string' && payload.delta) {
    const last = message.blocks.at(-1);
    if (last?.type === 'thinking' && last.streaming) {
      last.text = appendWithOverlap(last.text, payload.delta);
    } else {
      message.blocks.push({ type: 'thinking', text: payload.delta, streaming: true });
    }
  } else if (event === 'thinking_end' || event === 'assistant_message_end') {
    closeThinking(message.blocks);
  } else if (event === 'tool_start') {
    closeThinking(message.blocks);
    const name = typeof payload.toolName === 'string' && payload.toolName ? payload.toolName : 'unknown';
    if (name !== 'clarify') {
      const id = toolId(payload, `tool:${message.blocks.length}`);
      if (!message.blocks.some((block) => block.type === 'tool' && block.toolCallId === id)) {
        message.blocks.push({
          type: 'tool',
          toolCallId: id,
          name,
          status: 'running',
          input: payload.args,
          activity: activity(payload.activity) ?? resolveToolActivity(name, 'running'),
          startedAt: input.timestamp,
        });
      }
    }
  } else if (event === 'tool_update') {
    const id = toolId(payload, '');
    const block = [...message.blocks].reverse().find((candidate): candidate is BrowserToolBlock => (
      candidate.type === 'tool' && (id ? candidate.toolCallId === id : candidate.name === payload.toolName)
    ));
    if (block) {
      if (payload.details !== undefined) block.details = mergeDetails(block.details, payload.details);
      if (typeof payload.textDelta === 'string' && payload.textDelta) {
        block.details = mergeDetails(block.details, { textDelta: payload.textDelta });
      }
    }
  } else if (event === 'tool_end') {
    const name = typeof payload.toolName === 'string' && payload.toolName ? payload.toolName : 'unknown';
    if (name !== 'clarify') {
      const id = toolId(payload, `tool:${message.blocks.length}`);
      let block = [...message.blocks].reverse().find((candidate): candidate is BrowserToolBlock => (
        candidate.type === 'tool' && candidate.toolCallId === id
      ));
      if (!block) {
        block = { type: 'tool', toolCallId: id, name, status: 'running', startedAt: input.timestamp };
        message.blocks.push(block);
      }
      const failed = payload.status === 'error' || payload.status === 'cancelled';
      block.status = failed ? 'error' : 'done';
      block.result = payload.result;
      block.activity = activity(payload.activity)
        ?? resolveToolActivity(name, failed ? 'failed' : 'completed', payload.result);
      block.completedAt = input.timestamp;
    }
  }

  return message;
}

export function finalizeStreamingMessage(message: BrowserChatMessage, failed = false): BrowserChatMessage {
  return {
    ...message,
    blocks: message.blocks.map((block): BrowserMessageBlock => {
      if (block.type === 'thinking') {
        return { ...block, text: block.text.trim(), streaming: false } satisfies BrowserThinkingBlock;
      }
      if (block.type === 'tool' && block.status === 'running') {
        return {
          ...block,
          status: failed ? 'error' : 'done',
          activity: resolveToolActivity(block.name, failed ? 'failed' : 'completed'),
        } satisfies BrowserToolBlock;
      }
      return { ...block };
    }),
  };
}

import type { AgentSourceContext } from './types.js';

const MAX_SESSION_CONTEXT_CHARS = 96_000;

interface SessionContextMetadata {
  key: string;
  name?: string;
  updatedAt: string;
}

function messageText(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const row = message as { role?: unknown; content?: unknown };
  if (row.role !== 'user' && row.role !== 'assistant') return null;
  if (typeof row.content === 'string') return `${row.role}: ${row.content}`;
  if (!Array.isArray(row.content)) return null;
  const text = row.content.flatMap((part) => {
    if (!part || typeof part !== 'object') return [];
    const block = part as { type?: unknown; text?: unknown };
    return block.type === 'text' && typeof block.text === 'string' ? [block.text] : [];
  }).join('\n');
  return text ? `${row.role}: ${text}` : null;
}

export function buildSessionAgentContext(
  metadata: SessionContextMetadata | null | undefined,
  messages: readonly unknown[],
  expectedVersion?: string,
): AgentSourceContext | null {
  if (!metadata || (expectedVersion && expectedVersion !== metadata.updatedAt)) return null;
  const transcript = messages.flatMap((message) => {
    const text = messageText(message);
    return text ? [text] : [];
  }).join('\n\n');
  const text = transcript.length <= MAX_SESSION_CONTEXT_CHARS
    ? transcript
    : transcript.slice(transcript.length - MAX_SESSION_CONTEXT_CHARS);
  return {
    kind: 'session',
    sourceId: metadata.key,
    version: metadata.updatedAt,
    title: metadata.name?.trim() || metadata.key,
    text,
    truncated: text.length < transcript.length,
  };
}

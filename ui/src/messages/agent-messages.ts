import type { Message, MessageContent } from './types.js';

/**
 * Maps pi-agent-core (or similar) message payloads into the web UI message model.
 */
export function normalizeAgentMessages(raw: readonly unknown[]): Message[] {
  return raw.map((m) => normalizeAgentMessage(m));
}

function normalizeAgentMessage(m: unknown): Message {
  const o = m as Record<string, unknown>;
  const roleRaw = String(o.role ?? 'assistant');
  const role: Message['role'] =
    roleRaw === 'user' || roleRaw === 'user-with-attachments'
      ? (roleRaw as Message['role'])
      : 'assistant';

  return {
    role,
    content: normalizeContentBlocks(o.content),
    attachments: o.attachments as Message['attachments'],
    timestamp: typeof o.timestamp === 'number' ? o.timestamp : Date.now(),
    thinking: o.thinking as string | undefined,
    thinkingStreaming: o.thinkingStreaming as boolean | undefined,
    usage: o.usage as Message['usage'],
  };
}

function normalizeContentBlocks(raw: unknown): MessageContent[] {
  if (raw == null) return [];
  if (typeof raw === 'string') return [{ type: 'text', text: raw }];
  if (!Array.isArray(raw)) return [{ type: 'text', text: String(raw) }];

  const out: MessageContent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const b = item as Record<string, unknown>;
    const t = b.type;
    if (t === 'text' && typeof b.text === 'string') {
      out.push({ type: 'text', text: b.text });
    } else if (t === 'image') {
      const src = b.source as { data?: string } | undefined;
      out.push({ type: 'image', source: src });
    } else if (t === 'tool_use' || t === 'tool_call') {
      const id = typeof b.id === 'string' ? b.id : crypto.randomUUID();
      const name = String(b.name ?? (b.function as { name?: string } | undefined)?.name ?? 'tool');
      const input = b.input ?? (b.function as { arguments?: unknown } | undefined)?.arguments;
      out.push({
        type: 'tool_use',
        id,
        name,
        input,
        status: 'done',
        result: typeof b.result === 'string' ? b.result : undefined,
      });
    }
  }
  return out;
}

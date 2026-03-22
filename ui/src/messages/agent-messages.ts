import type { Message, MessageContent, ThinkingContent, ToolUseContent } from './types.js';

// =============================================================================
// Type definitions for safe type narrowing (replaces Record<string, unknown> casts)
// =============================================================================

interface WireContentBlock {
  type?: string;
  text?: string;
  name?: string;
  args?: Record<string, unknown>;
  input?: unknown;
  function?: { name?: string; arguments?: string | unknown };
  result?: string;
  source?: { data?: string; media_type?: string };
  id?: string;
}

interface WireMessage {
  role?: string;
  content?: unknown;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  toolCalls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }>;
  attachments?: unknown;
  thinking?: string;
  thinkingStreaming?: boolean;
  usage?: unknown;
  timestamp?: string | number;
  tool_call_id?: string;
  toolCallId?: string;
  isError?: boolean;
}

/** Tool-related blocks in session wire format (tool_use / OpenAI / pi toolCall). */
interface ToolCallBlock extends WireContentBlock {
  type?: string;
  name?: string;
  args?: Record<string, unknown>;
  /** Session/pi format often uses `arguments` (same role as `args`). */
  arguments?: unknown;
  input?: unknown;
  function?: { name?: string; arguments?: string | unknown };
  result?: string;
  status?: string;
}

function isWireSessionMessage(item: unknown): item is WireMessage {
  return typeof item === 'object' && item !== null && 'role' in item;
}

function isToolCallBlock(item: unknown): item is ToolCallBlock {
  if (!item || typeof item !== 'object') return false;
  const t = (item as Record<string, unknown>).type;
  return t === 'tool_use' || t === 'tool_call' || t === 'toolCall';
}

function extractToolBlockId(block: ToolCallBlock): string {
  if (typeof block.id === 'string' && block.id.length > 0) return block.id;
  return crypto.randomUUID();
}

function parseMaybeJsonString(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Prefer pi `args`, then session `arguments`, then `input` / OpenAI `function.arguments`. */
function extractToolCallBlockInput(block: ToolCallBlock): unknown {
  const raw = block.args ?? block.arguments ?? block.input ?? block.function?.arguments;
  const parsed = parseMaybeJsonString(raw);
  return parsed !== undefined && parsed !== null ? parsed : {};
}

// =============================================================================
// Type guards for wire format blocks
// =============================================================================

function isObjectWithType(item: unknown, type: string): boolean {
  return typeof item === 'object' && item !== null && (item as Record<string, unknown>).type === type;
}

function isWireContentBlock(item: unknown): item is WireContentBlock {
  return typeof item === 'object' && item !== null;
}

function extractTextFromBlock(item: WireContentBlock): string {
  if (typeof item.text === 'string') return item.text;
  if (item.type === 'thinking' && typeof (item as Record<string, unknown>).thinking === 'string') {
    return String((item as Record<string, unknown>).thinking);
  }
  return '';
}

/** Plain text for search / previews over wire-format or UI message content. */
export function messageWireSearchText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: string[] = [];
  for (const item of content) {
    if (!isWireContentBlock(item)) continue;
    const t = item.type;
    if (t === 'text' && typeof item.text === 'string') {
      parts.push(item.text);
    } else if (t === 'thinking') {
      const th =
        typeof (item as WireContentBlock & { thinking?: string }).thinking === 'string'
          ? (item as { thinking: string }).thinking
          : typeof item.text === 'string'
            ? item.text
            : '';
      if (th) parts.push(th);
    } else if (t === 'tool_use' || t === 'toolCall' || t === 'tool_call') {
      parts.push(String(item.name ?? 'tool'));
    }
  }
  return parts.join(' ');
}

/**
 * Maps pi-agent-core (or similar) message payloads into the web UI message model.
 */
export function normalizeAgentMessages(raw: readonly unknown[]): Message[] {
  return sessionWireToUiMessages(raw);
}

/**
 * Convert session/API wire format (including toolResult rows) into chat UI messages.
 */
export function sessionWireToUiMessages(raw: readonly unknown[]): Message[] {
  const out: Message[] = [];

  for (const item of raw) {
    if (!isWireSessionMessage(item)) continue;
    const m = item;
    const role = String(m.role ?? '');

    if (role === 'system') {
      continue;
    }

    if (role === 'toolResult' || role === 'tool') {
      applyToolResultToLastAssistant(out, m);
      continue;
    }

    if (role === 'user' || role === 'user-with-attachments') {
      out.push(buildUserMessage(m));
      continue;
    }

    if (role === 'assistant') {
      out.push(buildAssistantMessage(m));
      continue;
    }
  }

  return out;
}

function buildUserMessage(m: WireMessage): Message {
  const roleRaw = String(m.role ?? 'user');
  const role: Message['role'] =
    roleRaw === 'user' || roleRaw === 'user-with-attachments'
      ? (roleRaw as Message['role'])
      : 'assistant';

  return {
    role,
    content: normalizeContentBlocks(m.content),
    attachments: m.attachments as Message['attachments'],
    timestamp: typeof m.timestamp === 'number' ? m.timestamp : parseTs(m.timestamp),
    thinking: typeof m.thinking === 'string' ? m.thinking : undefined,
    thinkingStreaming: typeof m.thinkingStreaming === 'boolean' ? m.thinkingStreaming : undefined,
    usage: m.usage as Message['usage'],
  };
}

function buildAssistantMessage(m: WireMessage): Message {
  const content = mergeAssistantContent(m);
  const hasThinkingBlock = content.some((b): b is ThinkingContent => b.type === 'thinking');
  return {
    role: 'assistant',
    content,
    attachments: m.attachments as Message['attachments'],
    timestamp: typeof m.timestamp === 'number' ? m.timestamp : parseTs(m.timestamp),
    thinking: hasThinkingBlock ? undefined : typeof m.thinking === 'string' ? m.thinking : undefined,
    thinkingStreaming: hasThinkingBlock
      ? undefined
      : typeof m.thinkingStreaming === 'boolean'
        ? m.thinkingStreaming
        : undefined,
    usage: m.usage as Message['usage'],
  };
}

function parseTs(raw: unknown): number {
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? Date.now() : t;
  }
  return Date.now();
}

function mergeAssistantContent(m: WireMessage): MessageContent[] {
  const blocks = normalizeContentBlocks(m.content);

  const legacyThinking = typeof m.thinking === 'string' ? m.thinking.trim() : '';
  if (legacyThinking && !blocks.some((b) => b.type === 'thinking')) {
    blocks.unshift({ type: 'thinking', text: m.thinking as string, streaming: false });
  }

  const tc = m.tool_calls;
  if (Array.isArray(tc)) {
    for (const call of tc) {
      if (!call?.id || blocks.some((b) => b.type === 'tool_use' && b.id === call.id)) {
        continue;
      }
      let input: unknown = call.function?.arguments;
      if (typeof input === 'string') {
        try {
          input = JSON.parse(input);
        } catch {
          /* keep string */
        }
      }
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.function?.name || 'tool',
        input,
        status: 'running',
      });
    }
  }

  const piTcs = m.toolCalls;
  if (Array.isArray(piTcs)) {
    for (const call of piTcs) {
      const id = call.id ?? crypto.randomUUID();
      if (blocks.some((b) => b.type === 'tool_use' && b.id === id)) {
        continue;
      }
      blocks.push({
        type: 'tool_use',
        id,
        name: call.name || 'tool',
        input: call.args,
        status: 'running',
      });
    }
  }

  return blocks;
}

function applyToolResultToLastAssistant(out: Message[], m: WireMessage): void {
  const lastAssistant = findLastAssistant(out);
  if (!lastAssistant) return;

  const id = String(m.tool_call_id ?? m.toolCallId ?? '');
  const text = extractToolResultText(m.content);
  const isError = Boolean(m.isError);

  const block = id
    ? lastAssistant.content.find(
        (b): b is ToolUseContent => b.type === 'tool_use' && b.id === id,
      )
    : undefined;

  if (block) {
    block.status = isError ? 'error' : 'done';
    block.result = text;
    return;
  }

  const running = lastAssistant.content.filter(
    (b): b is ToolUseContent => b.type === 'tool_use' && b.status === 'running',
  );
  if (running.length === 1) {
    running[0].status = isError ? 'error' : 'done';
    running[0].result = text;
  }
}

function findLastAssistant(messages: Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      return messages[i];
    }
  }
  return null;
}

function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((c): c is WireContentBlock => isWireContentBlock(c) && c.type === 'text')
      .map((c) => String(c.text ?? ''))
      .join('\n');
  }
  return String(content ?? '');
}

function normalizeContentBlocks(raw: unknown): MessageContent[] {
  if (raw == null) return [];
  if (typeof raw === 'string') {
    return raw.trim() ? [{ type: 'text', text: raw }] : [];
  }
  if (!Array.isArray(raw)) {
    return [{ type: 'text', text: String(raw) }];
  }

  const out: MessageContent[] = [];
  for (const item of raw) {
    if (!isWireContentBlock(item)) continue;
    
    const t = item.type;
    if (t === 'text' && typeof item.text === 'string') {
      out.push({ type: 'text', text: item.text });
    } else if (t === 'thinking') {
      const th =
        typeof (item as WireContentBlock & { thinking?: string }).thinking === 'string'
          ? (item as { thinking: string }).thinking
          : typeof item.text === 'string'
            ? item.text
            : '';
      out.push({ type: 'thinking', text: th, streaming: false });
    } else if (t === 'image') {
      out.push({ type: 'image', source: item.source });
    } else if (t === 'tool_use' || t === 'tool_call') {
      if (!isToolCallBlock(item)) continue;
      const id = extractToolBlockId(item);
      const name = String(item.name ?? item.function?.name ?? 'tool');
      const input = item.input ?? item.function?.arguments;
      out.push({
        type: 'tool_use',
        id,
        name,
        input,
        status: 'done',
        result: typeof item.result === 'string' ? item.result : undefined,
      });
    } else if (t === 'toolCall') {
      if (!isToolCallBlock(item)) continue;
      const id = extractToolBlockId(item);
      const name = String(item.name ?? item.function?.name ?? 'tool');
      out.push({
        type: 'tool_use',
        id,
        name,
        input: extractToolCallBlockInput(item),
        status: 'done',
        result: typeof item.result === 'string' ? item.result : undefined,
      });
    }
  }
  return out;
}

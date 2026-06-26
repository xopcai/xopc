// Wire-format types and low-level extractors shared by agent-message normalizers.
// All types/guards live here so the orchestrator (agent-messages.ts) stays focused
// on the user-/assistant-/tool-result shaped business logic.

export interface WireContentBlock {
  type?: string;
  text?: string;
  name?: string;
  args?: Record<string, unknown>;
  input?: unknown;
  function?: { name?: string; arguments?: string | unknown };
  result?: string;
  source?: { data?: string; media_type?: string };
  data?: string;
  mimeType?: string;
  id?: string;
}

export interface WireMessage {
  role?: string;
  content?: unknown;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  toolCalls?: Array<{
    id?: string;
    name: string;
    args?: unknown;
    result?: string;
    isError?: boolean;
  }>;
  /** Persisted media refs (`media://…`) on user/assistant turns. */
  media?: unknown;
  /** Inline / legacy attachment payloads on user/assistant turns. */
  attachments?: unknown;
  usage?: unknown;
  timestamp?: string | number;
  tool_call_id?: string;
  toolCallId?: string;
  isError?: boolean;
}

/** Tool-related blocks in session wire format (tool_use / OpenAI / pi toolCall). */
export interface ToolCallBlock extends WireContentBlock {
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

export function isWireSessionMessage(item: unknown): item is WireMessage {
  return typeof item === 'object' && item !== null && 'role' in item;
}

export function isToolCallBlock(item: unknown): item is ToolCallBlock {
  if (!item || typeof item !== 'object') return false;
  const t = (item as Record<string, unknown>).type;
  return t === 'tool_use' || t === 'tool_call' || t === 'toolCall';
}

export function isWireContentBlock(item: unknown): item is WireContentBlock {
  return typeof item === 'object' && item !== null;
}

export function extractToolBlockId(block: ToolCallBlock): string {
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
export function extractToolCallBlockInput(block: ToolCallBlock): unknown {
  const raw = block.args ?? block.arguments ?? block.input ?? block.function?.arguments;
  const parsed = parseMaybeJsonString(raw);
  return parsed !== undefined && parsed !== null ? parsed : {};
}

export function parseTs(raw: unknown): number {
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? Date.now() : t;
  }
  return Date.now();
}

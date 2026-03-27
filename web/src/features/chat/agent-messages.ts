import type { Message, MessageAttachment, MessageContent, ThinkingContent, ToolUseContent } from '@/features/chat/messages.types';

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

function isWireContentBlock(item: unknown): item is WireContentBlock {
  return typeof item === 'object' && item !== null;
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

function normalizeWireAttachments(raw: unknown): Message['attachments'] {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((item) => normalizeOneAttachment(item));
}

function normalizeOneAttachment(item: unknown): MessageAttachment {
  if (!item || typeof item !== 'object') {
    return { name: 'file', mimeType: 'application/octet-stream' };
  }
  const a = item as Record<string, unknown>;
  const data = typeof a.data === 'string' ? a.data : undefined;
  const content =
    typeof a.content === 'string' && a.content.length > 0 ? a.content : data;
  const name = typeof a.name === 'string' && a.name.length > 0 ? a.name : 'file';
  let mimeType = typeof a.mimeType === 'string' && a.mimeType.length > 0 ? a.mimeType : '';
  if (!mimeType && typeof a.type === 'string' && a.type.includes('/')) {
    mimeType = a.type;
  }
  if (!mimeType) {
    mimeType = 'application/octet-stream';
  }
  const preview =
    typeof a.preview === 'string' && a.preview.length > 0
      ? a.preview
      : mimeType.startsWith('image/') && content
        ? content
        : undefined;

  return {
    id: typeof a.id === 'string' ? a.id : undefined,
    name,
    mimeType,
    type: typeof a.type === 'string' ? a.type : undefined,
    size: typeof a.size === 'number' ? a.size : undefined,
    content,
    data: data ?? content,
    preview,
    extractedText: typeof a.extractedText === 'string' ? a.extractedText : undefined,
    workspaceRelativePath:
      typeof a.workspaceRelativePath === 'string' && a.workspaceRelativePath.length > 0
        ? a.workspaceRelativePath
        : undefined,
  };
}

/** Remove persisted inbound machine lines from bubble text (attachments show separately). */
export function stripInboundFileMachineText(text: string): string {
  if (!text.includes('xopcbot-path:')) return text;
  let out = text;
  // Multiline (canonical persist format)
  out = out.replace(
    /\s*\[File:[^\]]+\]\s*\r?\nxopcbot-path:rel:[^\r\n]+\r?\n\s*xopcbot-path:abs:[^\r\n]+/g,
    '',
  );
  // Single line (e.g. markdown collapsed whitespace)
  out = out.replace(/\s*\[File:[^\]]+\]\s+xopcbot-path:rel:\S+\s+xopcbot-path:abs:\S+/g, '');
  out = out.replace(/\s*\[File:[^\]]+\]\s*xopcbot-path:rel:\S+\s*xopcbot-path:abs:\S+/g, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function parseFileLineMeta(fileMeta: string): { name: string; mimeType: string; size: number } {
  const nameMatch = fileMeta.match(/^([^(]+?)\s*\(/);
  const name = nameMatch ? nameMatch[1].trim() : 'file';
  const mimeMatch = fileMeta.match(/\(\s*([^,]+)\s*,\s*(\d+)\s*bytes\s*\)/i);
  const mimeType = mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream';
  const size = mimeMatch ? parseInt(mimeMatch[2], 10) : 0;
  return { name, mimeType, size };
}

function extractAttachmentsFromUserContent(raw: unknown): Message['attachments'] | undefined {
  const chunks: string[] = [];
  if (typeof raw === 'string') {
    chunks.push(raw);
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === 'object' && (item as { type?: string }).type === 'text') {
        const t = (item as { text?: string }).text;
        if (typeof t === 'string') chunks.push(t);
      }
    }
  }
  const text = chunks.join('\n');
  if (!text.includes('xopcbot-path:rel:')) return undefined;

  const out: NonNullable<Message['attachments']> = [];
  const seen = new Set<string>();

  // Single line: rel is \S+ so it stops before " xopcbot-path:abs:" (fixes greedy [^\n]+ bug)
  const reSingle = /\[File: ([^\]]+)\]\s*xopcbot-path:rel:(\S+)\s*xopcbot-path:abs:\S+/g;
  let m: RegExpExecArray | null;
  while ((m = reSingle.exec(text)) !== null) {
    const rel = m[2].trim();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const { name, mimeType, size } = parseFileLineMeta(m[1]);
    out.push({
      name,
      mimeType,
      size,
      type: 'document',
      workspaceRelativePath: rel,
    });
  }

  const reMulti =
    /\[File: ([^\]]+)\]\s*\r?\nxopcbot-path:rel:([^\r\n]+)\r?\n\s*xopcbot-path:abs:[^\r\n]+/g;
  while ((m = reMulti.exec(text)) !== null) {
    const rel = m[2].trim();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const { name, mimeType, size } = parseFileLineMeta(m[1]);
    out.push({
      name,
      mimeType,
      size,
      type: 'document',
      workspaceRelativePath: rel,
    });
  }

  return out.length ? out : undefined;
}

function applyStripToUserContent(
  role: Message['role'],
  blocks: MessageContent[],
): MessageContent[] {
  if (role !== 'user' && role !== 'user-with-attachments') return blocks;
  const mapped = blocks.map((b) => {
    if (b.type === 'text' && typeof b.text === 'string') {
      return { ...b, text: stripInboundFileMachineText(b.text) };
    }
    return b;
  });
  return mapped.filter((b) => {
    if (b.type === 'text' && (!b.text || !b.text.trim())) return false;
    return true;
  });
}

/** Deduplicate attachments that refer to the same workspace file (wire + parsed content often disagree on `name`). */
function attachmentStableKey(a: MessageAttachment): string {
  const rel = a.workspaceRelativePath?.replace(/\\/g, '/').trim();
  if (rel) return `rel:${rel}`;
  if (a.id) return `id:${a.id}`;
  return `name:${a.name ?? 'file'}|${a.mimeType ?? ''}`;
}

function dedupeAttachments(list: Message['attachments'] | undefined): Message['attachments'] | undefined {
  if (!list?.length) return undefined;
  const out: NonNullable<Message['attachments']> = [];
  const seen = new Set<string>();
  for (const a of list) {
    const k = attachmentStableKey(a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out.length ? out : undefined;
}

function mergeUserAttachments(
  wire: Message['attachments'] | undefined,
  fromContent: Message['attachments'] | undefined,
): Message['attachments'] | undefined {
  return dedupeAttachments([...(wire ?? []), ...(fromContent ?? [])]);
}

function buildUserMessage(m: WireMessage): Message {
  const roleRaw = String(m.role ?? 'user');
  const role: Message['role'] =
    roleRaw === 'user' || roleRaw === 'user-with-attachments'
      ? (roleRaw as Message['role'])
      : 'assistant';

  const fromContent = extractAttachmentsFromUserContent(m.content);

  return {
    role,
    content: applyStripToUserContent(role, normalizeContentBlocks(m.content)),
    attachments: mergeUserAttachments(normalizeWireAttachments(m.attachments), fromContent),
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
    attachments: dedupeAttachments(normalizeWireAttachments(m.attachments)),
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

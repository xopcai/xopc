/**
 * Session wire → UI message helpers.
 *
 * Converts raw session messages (unknown content shapes) to typed Message[].
 * Handles toolResult/tool role messages, merges consecutive assistant fragments,
 * and supports OpenAI tool_calls / pi toolCalls formats — matching the web gateway console.
 *
 * Ported from web/src/features/chat/agent-messages.ts
 */
import type { InfiniteData } from '@tanstack/react-query';
import type { Message, MessageAttachment, MessageContent } from './messages.types';
import {
  applyStripToUserContent,
  extractAttachmentsFromUserContent,
  mergeUserAttachments,
} from './inbound-message-text';
import type { SessionMessagePage } from '../../query/sessions';

// ── Wire types ──────────────────────────────────────────────

export type WireContentBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  source?: { data?: string; media_type?: string };
  data?: string;
  mimeType?: string;
  mime_type?: string;
  workspaceRelativePath?: string;
  workspace_relative_path?: string;
  uri?: string;
  url?: string;
  audioUri?: string;
  audio_url?: string;
  durationSeconds?: number;
  duration_seconds?: number;
  id?: string;
  messageId?: string;
  name?: string;
  input?: unknown;
  args?: unknown;
  arguments?: unknown;
  function?: { name?: string; arguments?: unknown };
  result?: string;
  status?: string;
};

export type WireMessage = {
  id?: string;
  messageId?: string;
  role?: string;
  content?: unknown;
  timestamp?: string | number;
  attachments?: unknown;
  media?: unknown;
  usage?: unknown;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  toolCalls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }>;
  tool_call_id?: string;
  toolCallId?: string;
  isError?: boolean;
  ttsAudio?: unknown;
  tts_audio?: unknown;
  tts?: unknown;
  audio?: unknown;
  ttsAudioUri?: string;
  tts_audio_uri?: string;
  audioUri?: string;
  audio_url?: string;
};

// ── Stable key helpers ─────────────────────────────────────

function wireMessageId(message: WireMessage): string | undefined {
  return typeof message.id === 'string' && message.id.trim()
    ? message.id.trim()
    : typeof message.messageId === 'string' && message.messageId.trim()
      ? message.messageId.trim()
      : undefined;
}

function stableWireContentKey(content: unknown): string {
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content ?? null);
  } catch {
    return String(content ?? '');
  }
}

export function wireMessageStableKey(raw: Record<string, unknown>, index: number): string {
  const message = raw as WireMessage;
  const id = wireMessageId(message) ?? '';
  const role = String(message.role ?? '');
  const timestamp = message.timestamp == null ? '' : String(message.timestamp);
  const toolCallId = String(message.tool_call_id ?? message.toolCallId ?? '');
  const contentKey = stableWireContentKey(message.content);
  return `${id}:${role}:${timestamp}:${toolCallId}:${contentKey || index}`;
}

export function dedupeWireMessages(raw: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const indexByKey = new Map<string, number>();
  const dedupedMessages: Array<Record<string, unknown>> = [];
  raw.forEach((message, index) => {
    const key = wireMessageStableKey(message, index);
    const existingIndex = indexByKey.get(key);
    if (existingIndex != null) {
      dedupedMessages[existingIndex] = message;
      return;
    }
    indexByKey.set(key, dedupedMessages.length);
    dedupedMessages.push(message);
  });
  return dedupedMessages;
}

export function wireMessagesOverlap(
  left: Array<Record<string, unknown>>,
  right: Array<Record<string, unknown>>,
): boolean {
  if (!left.length || !right.length) return false;
  const rightKeys = new Set(right.map((message, index) => wireMessageStableKey(message, index)));
  return left.some((message, index) => rightKeys.has(wireMessageStableKey(message, index)));
}

// ── Page overlap helpers ───────────────────────────────────

export function wirePagesOverlap(left: SessionMessagePage | null, right: SessionMessagePage | null): boolean {
  return wireMessagesOverlap(
    (left?.session.messages ?? []) as Array<Record<string, unknown>>,
    (right?.session.messages ?? []) as Array<Record<string, unknown>>,
  );
}

export function wirePageContainsMessages(page: SessionMessagePage | null): page is SessionMessagePage {
  return Array.isArray(page?.session.messages) && page.session.messages.length > 0;
}

export function wirePageStartsWithSameMessage(left: SessionMessagePage | null, right: SessionMessagePage | null): boolean {
  if (!wirePageContainsMessages(left) || !wirePageContainsMessages(right)) return false;
  return wireMessageStableKey(left.session.messages[0] as Record<string, unknown>, 0)
    === wireMessageStableKey(right.session.messages[0] as Record<string, unknown>, 0);
}

// ── Page merge helpers ─────────────────────────────────────

export function mergeLatestSessionHistoryPage(
  oldData: InfiniteData<SessionMessagePage | null, string | undefined> | undefined,
  latestPage: SessionMessagePage,
): InfiniteData<SessionMessagePage | null, string | undefined> {
  if (!oldData) {
    return { pages: [latestPage], pageParams: [undefined] };
  }

  const oldPages = oldData.pages;
  const shouldReplaceHead = wirePageStartsWithSameMessage(latestPage, oldPages[0])
    || wirePagesOverlap(latestPage, oldPages[0]);
  const preservedPages = shouldReplaceHead ? oldPages.slice(1) : oldPages;
  const preservedPageParams = shouldReplaceHead ? oldData.pageParams.slice(1) : oldData.pageParams;

  return {
    pages: [latestPage, ...preservedPages],
    pageParams: [undefined, ...preservedPageParams],
  };
}

export function appendOlderSessionHistoryPage(
  oldData: InfiniteData<SessionMessagePage | null, string | undefined> | undefined,
  olderPage: SessionMessagePage,
  olderCursor: string,
): InfiniteData<SessionMessagePage | null, string | undefined> | undefined {
  if (!oldData) return oldData;
  if (oldData.pageParams.includes(olderCursor)) return oldData;

  const lastPage = oldData.pages[oldData.pages.length - 1];
  if (wirePageStartsWithSameMessage(olderPage, lastPage)) return oldData;

  return {
    pages: [...oldData.pages, olderPage],
    pageParams: [...oldData.pageParams, olderCursor],
  };
}

// ── Content block parsers ──────────────────────────────────

function wireImageBlockToContent(block: WireContentBlock): MessageContent | null {
  const fromSource = block.source?.data;
  if (typeof fromSource === 'string' && fromSource.length > 0) {
    return { type: 'image', source: { data: fromSource, media_type: block.source?.media_type } };
  }

  const raw = block.data;
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith('data:') || /^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) {
    return { type: 'image', source: { data: trimmed } };
  }

  const mime =
    typeof block.mimeType === 'string' && block.mimeType.includes('/')
      ? block.mimeType
      : 'image/png';
  return { type: 'image', source: { data: `data:${mime};base64,${trimmed.replace(/\s/g, '')}` } };
}

/** Parse a single content block from wire format. */
export function parseContentBlock(b: Record<string, unknown>): MessageContent | null {
  const block = b as WireContentBlock;
  const t = block.type;
  if (t === 'text') return { type: 'text', text: String(block.text ?? '') };
  if (t === 'thinking') return { type: 'thinking', text: String(block.text ?? block.thinking ?? ''), streaming: false };
  const mimeType = firstString(block.mimeType, block.mime_type);
  if (t === 'audio' || t === 'tts_audio' || mimeType?.startsWith('audio/')) {
    const parsed = parseTtsAudioBlock(block);
    if (parsed) return parsed;
    return {
      type: 'audio',
      workspaceRelativePath: firstString(block.workspaceRelativePath, block.workspace_relative_path),
      uri: firstString(block.uri, block.url, block.audioUri, block.audio_url),
      mimeType: mimeType ?? (t === 'tts_audio' ? 'audio/mpeg' : undefined),
      name: block.name,
      durationSeconds: finiteNumber(block.durationSeconds ?? block.duration_seconds),
    };
  }
  if (t === 'image' || (typeof block.data === 'string' && typeof block.mimeType === 'string')) {
    return wireImageBlockToContent(block);
  }
  if (t === 'tool_use' || t === 'tool_call' || t === 'toolCall') {
    return {
      type: 'tool_use',
      id: String(block.id ?? `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
      name: String(block.name ?? block.function?.name ?? 'tool'),
      input: block.input ?? block.args ?? block.arguments ?? block.function?.arguments,
      status: (block.status === 'running' || block.status === 'error') ? block.status : 'done' as const,
      result: block.result,
    };
  }
  return { type: 'text', text: String(block.text ?? '') };
}

/** Normalize raw content to MessageContent[]. */
function normalizeContentBlocks(raw: unknown): MessageContent[] {
  if (raw == null) return [];
  if (typeof raw === 'string') return raw.trim() ? [{ type: 'text', text: raw }] : [];
  if (!Array.isArray(raw)) return [{ type: 'text', text: String(raw) }];
  return raw
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map(parseContentBlock)
    .filter((block): block is MessageContent => block != null);
}

// ── Assistant content builders ─────────────────────────────

/** Build assistant content, including top-level tool_calls / toolCalls fields. */
function buildAssistantContent(m: WireMessage): MessageContent[] {
  const blocks = normalizeContentBlocks(m.content);

  // OpenAI format: top-level tool_calls array
  if (Array.isArray(m.tool_calls)) {
    for (const call of m.tool_calls) {
      if (!call?.id || blocks.some((b) => b.type === 'tool_use' && b.id === call.id)) continue;
      let input: unknown = call.function?.arguments;
      if (typeof input === 'string') { try { input = JSON.parse(input); } catch { /* keep string */ } }
      blocks.push({ type: 'tool_use', id: call.id, name: call.function?.name || 'tool', input, status: 'running' });
    }
  }

  // Pi format: top-level toolCalls array
  if (Array.isArray(m.toolCalls)) {
    for (const call of m.toolCalls) {
      const id = call.id ?? `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      if (blocks.some((b) => b.type === 'tool_use' && b.id === id)) continue;
      blocks.push({ type: 'tool_use', id, name: call.name || 'tool', input: call.args, status: 'running' });
    }
  }

  appendTopLevelTtsAudio(blocks, m);

  return blocks;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseTtsAudioBlock(raw: unknown): MessageContent | null {
  if (typeof raw === 'string') {
    const uri = raw.trim();
    return uri ? { type: 'audio', uri, mimeType: 'audio/mpeg', name: 'voice.mp3' } : null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const uri = firstString(item.uri, item.url, item.audioUri, item.audio_url);
  const workspaceRelativePath = firstString(
    item.workspaceRelativePath,
    item.workspace_relative_path,
    item.path,
  );
  const data = typeof item.data === 'string' && item.data.trim() ? item.data.trim() : undefined;
  if (!uri && !workspaceRelativePath && !data) return null;
  const mimeType = firstString(item.mimeType, item.mime_type) ?? 'audio/mpeg';
  const dataUri = data
    ? (data.startsWith('data:') ? data : `data:${mimeType};base64,${data.replace(/\s/g, '')}`)
    : undefined;
  return {
    type: 'audio',
    workspaceRelativePath,
    uri: uri ?? dataUri,
    mimeType,
    name: firstString(item.name) ?? 'voice.mp3',
    durationSeconds: finiteNumber(item.durationSeconds ?? item.duration_seconds),
  };
}

function audioContentKey(block: MessageContent): string {
  return block.type === 'audio'
    ? block.workspaceRelativePath || block.uri || block.name || ''
    : '';
}

function appendTopLevelTtsAudio(content: MessageContent[], m: WireMessage): void {
  const raw = m as Record<string, unknown>;
  const candidates = [m.ttsAudio, m.tts_audio, m.tts, m.audio];
  const topLevelUri = firstString(m.ttsAudioUri, m.tts_audio_uri, m.audioUri, m.audio_url);
  if (topLevelUri) {
    candidates.push({
      uri: topLevelUri,
      mimeType: raw.mimeType,
      mime_type: raw.mime_type,
      name: raw.name,
      durationSeconds: raw.durationSeconds,
      duration_seconds: raw.duration_seconds,
    });
  }

  const existingKeys = new Set(content.map(audioContentKey).filter(Boolean));
  for (const candidate of candidates) {
    const items = Array.isArray(candidate) ? candidate : [candidate];
    for (const item of items) {
      const block = parseTtsAudioBlock(item);
      const key = block ? audioContentKey(block) : '';
      if (!block || !key || existingKeys.has(key)) continue;
      existingKeys.add(key);
      content.push(block);
    }
  }
}

/** Extract plain-text from toolResult content. */
function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is Record<string, unknown> => c != null && typeof c === 'object' && c.type === 'text')
      .map((c) => String(c.text ?? ''))
      .join('\n');
  }
  return String(content ?? '');
}

/** Apply a toolResult message's result to the last assistant's matching tool_use block. */
function applyToolResultToLastAssistant(out: Message[], m: WireMessage): void {
  let lastAssistant: Message | null = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'assistant') { lastAssistant = out[i]; break; }
  }
  if (!lastAssistant) return;

  const id = String(m.tool_call_id ?? m.toolCallId ?? '');
  const text = extractToolResultText(m.content);
  const isError = Boolean(m.isError);

  // Match by tool_call_id
  if (id) {
    const block = lastAssistant.content.find(
      (b): b is import('./messages.types').ToolUseContent =>
        b.type === 'tool_use' && b.id === id,
    );
    if (block) {
      block.status = isError ? 'error' : 'done';
      block.result = text;
      return;
    }
  }

  // Fallback: if exactly one tool is still running, apply to it
  const running = lastAssistant.content.filter(
    (b): b is import('./messages.types').ToolUseContent =>
      b.type === 'tool_use' && b.status === 'running',
  );
  if (running.length === 1) {
    running[0].status = isError ? 'error' : 'done';
    running[0].result = text;
  }
}

// ── Merge helpers ──────────────────────────────────────────

/** Merge two assistant content arrays: dedupe tool_use by id, dedupe adjacent identical thinking. */
function mergeAssistantContentFragments(left: MessageContent[], right: MessageContent[]): MessageContent[] {
  const out: MessageContent[] = left.map((b) => ({ ...b }));
  const toolIndexById = new Map<string, number>();
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    if (b.type === 'tool_use') toolIndexById.set(b.id, i);
  }

  for (const b of right) {
    if (b.type === 'tool_use' && toolIndexById.has(b.id)) {
      const idx = toolIndexById.get(b.id)!;
      out[idx] = { ...b }; // keep the later (more complete) version
      continue;
    }
    if (b.type === 'thinking' && out.length > 0) {
      const last = out[out.length - 1];
      if (last.type === 'thinking' && (last.text || '').trim() === (b.text || '').trim()) continue;
    }
    if (b.type === 'tool_use') toolIndexById.set(b.id, out.length);
    out.push({ ...b });
  }
  return out;
}

/** Merge consecutive assistant messages into a single bubble (session stores fragments). */
function mergeConsecutiveAssistantMessages(messages: Message[]): Message[] {
  if (messages.length < 2) return messages;
  const out: Message[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant') { out.push(m); continue; }
    const prev = out[out.length - 1];
    if (prev?.role === 'assistant') {
      prev.content = mergeAssistantContentFragments(prev.content, m.content);
      if (m.timestamp != null) prev.timestamp = m.timestamp;
      const mergedUsage = normalizeWireUsage(m.usage);
      if (mergedUsage) prev.usage = mergedUsage;
    } else {
      out.push({ ...m, content: [...m.content] });
    }
  }
  return out;
}

// ── Attachment helpers ─────────────────────────────────────

/** Normalize gateway wire usage (input/output vs inputTokens, nested cost object). */
export function normalizeWireUsage(raw: unknown): Message['usage'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, unknown>;
  const inputTokens =
    typeof u.inputTokens === 'number' ? u.inputTokens
      : typeof u.input === 'number' ? u.input
        : undefined;
  const outputTokens =
    typeof u.outputTokens === 'number' ? u.outputTokens
      : typeof u.output === 'number' ? u.output
        : undefined;
  const totalTokens = typeof u.totalTokens === 'number' ? u.totalTokens : undefined;

  let cost: number | undefined;
  const rawCost = u.cost;
  if (typeof rawCost === 'number') {
    cost = rawCost;
  } else if (rawCost && typeof rawCost === 'object') {
    const nested = rawCost as Record<string, unknown>;
    if (typeof nested.total === 'number') cost = nested.total;
  }

  if (inputTokens == null && outputTokens == null && totalTokens == null && cost == null) {
    return undefined;
  }
  return { inputTokens, outputTokens, totalTokens, cost };
}

function parseTimestamp(raw: string | number | undefined): number | undefined {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

function normalizeAttachments(raw: unknown): MessageAttachment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map((item): MessageAttachment => ({
      id: typeof item.id === 'string' ? item.id : undefined,
      name: typeof item.name === 'string' ? item.name : undefined,
      type: typeof item.type === 'string' ? item.type : undefined,
      mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
      size: typeof item.size === 'number' ? item.size : undefined,
      content: typeof item.content === 'string' ? item.content : undefined,
      data: typeof item.data === 'string' ? item.data : undefined,
      preview: typeof item.preview === 'string' ? item.preview : undefined,
      extractedText: typeof item.extractedText === 'string' ? item.extractedText : undefined,
      uri: typeof item.uri === 'string' ? item.uri : undefined,
      workspaceRelativePath: typeof item.workspaceRelativePath === 'string' ? item.workspaceRelativePath : undefined,
      durationSeconds: typeof item.durationSeconds === 'number' ? item.durationSeconds : undefined,
    }));
  return out.length ? out : undefined;
}

function isAudioAttachment(att: MessageAttachment): boolean {
  return att.type === 'voice' || att.type === 'audio' || att.mimeType?.startsWith('audio/') === true;
}

function stripAudioAttachments(attachments: MessageAttachment[] | undefined): MessageAttachment[] | undefined {
  if (!attachments?.length) return attachments;
  const nonAudio = attachments.filter((att) => !isAudioAttachment(att));
  return nonAudio.length ? nonAudio : undefined;
}

function audioAttachmentToContent(att: MessageAttachment): MessageContent | null {
  if (!isAudioAttachment(att)) return null;
  const payload = att.preview || att.content || att.data;
  const mimeType = att.mimeType || 'audio/mpeg';
  return {
    type: 'audio',
    workspaceRelativePath: att.workspaceRelativePath,
    uri: att.uri ?? (payload ? (payload.startsWith('data:') ? payload : `data:${mimeType};base64,${payload.replace(/\s/g, '')}`) : undefined),
    mimeType,
    name: att.name,
    durationSeconds: att.durationSeconds,
  };
}

function appendAudioAttachments(content: MessageContent[], attachments: MessageAttachment[] | undefined): MessageContent[] {
  if (!attachments?.length) return content;
  const existingKeys = new Set(
    content
      .filter((b) => b.type === 'audio')
      .map((b) => b.workspaceRelativePath || b.uri || b.name || '')
      .filter(Boolean),
  );
  const audioBlocks = attachments
    .map(audioAttachmentToContent)
    .filter((b): b is MessageContent => b != null)
    .filter((b) => {
      const key = b.type === 'audio' ? b.workspaceRelativePath || b.uri || b.name || '' : '';
      if (!key || existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });
  return audioBlocks.length ? [...content, ...audioBlocks] : content;
}

// ── Main parse function ────────────────────────────────────

/**
 * Convert raw session messages (unknown content shape) to typed Message[].
 *
 * Handles toolResult/tool role messages, merges consecutive assistant fragments,
 * and supports OpenAI tool_calls / pi toolCalls formats — matching the web gateway console.
 */
export function parseSessionMessages(raw: Array<Record<string, unknown>>): Message[] {
  const out: Message[] = [];

  for (const item of raw) {
    const m = item as unknown as WireMessage;
    const role = String(m.role ?? '');

    // Skip system messages
    if (role === 'system') continue;

    // Tool results → apply to the last assistant's tool_use block
    if (role === 'toolResult' || role === 'tool') {
      applyToolResultToLastAssistant(out, m);
      continue;
    }

    if (role === 'user' || role === 'user-with-attachments') {
      const roleTyped = role as Message['role'];
      const fromContent = extractAttachmentsFromUserContent(m.content);
      const attachments = mergeUserAttachments(normalizeAttachments(m.attachments ?? m.media), fromContent);
      out.push({
        id: wireMessageId(m),
        role: roleTyped,
        content: applyStripToUserContent(roleTyped, normalizeContentBlocks(m.content)),
        attachments,
        timestamp: parseTimestamp(m.timestamp),
      });
      continue;
    }

    if (role === 'assistant') {
      const attachments = normalizeAttachments(m.attachments ?? m.media);
      const content = appendAudioAttachments(buildAssistantContent(m), attachments);
      out.push({
        id: wireMessageId(m),
        role: 'assistant',
        content,
        attachments: stripAudioAttachments(attachments),
        usage: normalizeWireUsage(m.usage),
        timestamp: parseTimestamp(m.timestamp),
      });
      continue;
    }

    // Unknown roles → skip (don't render as assistant)
  }

  return mergeConsecutiveAssistantMessages(out);
}

import type {
  Message,
  MessageContent,
  ThinkingContent,
  ToolUseContent,
} from '@/features/chat/messages/messages.types';
import {
  extractToolBlockId,
  extractToolCallBlockInput,
  isToolCallBlock,
  isWireContentBlock,
  isWireSessionMessage,
  parseTs,
  type WireContentBlock,
  type WireMessage,
} from '@/features/chat/messages/wire-format';
import {
  dedupeAttachments,
  extractAttachmentsFromUserContent,
  mergeUserAttachments,
  normalizeWireAttachments,
} from '@/features/chat/messages/wire-attachments';
import {
  collapseExpandedSkillBlockForDisplay,
  stripExpandedAtFileBlocks,
  stripInboundFileMachineText,
  stripStartupContextForDisplay,
} from '@/features/chat/messages/wire-text-scrub';

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

function thinkingBlockComparableText(b: MessageContent): string {
  if (b.type !== 'thinking') {
    return '';
  }
  const x = b as ThinkingContent & { thinking?: string };
  return typeof x.text === 'string' ? x.text : typeof x.thinking === 'string' ? x.thinking : '';
}

/**
 * Merge two assistant content arrays when consecutive wire rows represent one turn.
 * - tool_use with the same id: keep the later block (e.g. completed tool after a fragment).
 * - adjacent thinking blocks with identical text: drop duplicate (streaming + persist overlap).
 */
function mergeAssistantContentFragments(left: MessageContent[], right: MessageContent[]): MessageContent[] {
  const out: MessageContent[] = left.map((b) => ({ ...b }));
  const toolIndexById = new Map<string, number>();
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    if (b.type === 'tool_use') {
      toolIndexById.set(b.id, i);
    }
  }

  for (const b of right) {
    if (b.type === 'tool_use' && toolIndexById.has(b.id)) {
      const idx = toolIndexById.get(b.id)!;
      out[idx] = { ...b };
      continue;
    }
    if (b.type === 'thinking' && out.length > 0) {
      const last = out[out.length - 1];
      if (last.type === 'thinking' && thinkingBlockComparableText(last) === thinkingBlockComparableText(b)) {
        continue;
      }
    }
    if (b.type === 'tool_use') {
      toolIndexById.set(b.id, out.length);
    }
    out.push({ ...b });
  }
  return out;
}

/**
 * Merge consecutive assistant bubbles into one (same as a single live streaming turn).
 * Persisted sessions often store one wire `assistant` row per thinking/tool fragment; without this,
 * the chat shows repeated "execution" lines after refresh.
 */
export function mergeConsecutiveAssistantMessages(messages: Message[]): Message[] {
  if (messages.length < 2) return messages;
  const out: Message[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant') {
      out.push(m);
      continue;
    }
    const prev = out[out.length - 1];
    if (prev?.role === 'assistant') {
      prev.content = mergeAssistantContentFragments(prev.content, m.content);
      if (m.timestamp != null) prev.timestamp = m.timestamp;
      if (m.usage) prev.usage = m.usage;
      if (m.attachments?.length) {
        prev.attachments = dedupeAttachments([...(prev.attachments ?? []), ...m.attachments]);
      }
    } else {
      out.push({
        ...m,
        content: [...m.content],
      });
    }
  }
  return out;
}

function lastAssistantIndex(messages: readonly Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant') return i;
  }
  return -1;
}

function assistantTextFingerprint(content: readonly MessageContent[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join('\n');
}

function assistantThinkingFingerprint(content: readonly MessageContent[]): string {
  return content
    .filter((b): b is ThinkingContent => b.type === 'thinking')
    .map((b) => (b.text ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

function assistantToolsFingerprint(content: readonly MessageContent[]): string {
  return content
    .filter((b): b is ToolUseContent => b.type === 'tool_use')
    .map((b) => {
      const result =
        typeof b.result === 'string' ? b.result.trim() : JSON.stringify(b.result ?? '');
      return `${b.name}|${b.status}|${result}`;
    })
    .join('\n');
}

/** True when two assistant rows would render the same in the chat column (ignoring timestamp / usage). */
export function assistantTurnVisuallyEquivalent(a: Message, b: Message): boolean {
  if (a.role !== 'assistant' || b.role !== 'assistant') return false;
  return (
    assistantTextFingerprint(a.content) === assistantTextFingerprint(b.content) &&
    assistantThinkingFingerprint(a.content) === assistantThinkingFingerprint(b.content) &&
    assistantToolsFingerprint(a.content) === assistantToolsFingerprint(b.content)
  );
}

function attachmentsEquivalent(
  a: Message['attachments'] | undefined,
  b: Message['attachments'] | undefined,
): boolean {
  const al = a?.length ?? 0;
  const bl = b?.length ?? 0;
  if (al !== bl) return false;
  if (al === 0) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

function usageEquivalent(a: Message['usage'], b: Message['usage']): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * After a live SSE turn, gateway reload often returns the same assistant text with a new
 * timestamp. Replacing the whole list remounts virtual rows and makes the last bubble flicker.
 * Keep prior message references when the visible turn is already equivalent.
 */
export function reconcileSessionSnapshot(prev: Message[], loaded: Message[]): Message[] {
  if (prev.length === 0 || loaded.length === 0) return loaded;

  const prevLastIdx = lastAssistantIndex(prev);
  const loadedLastIdx = lastAssistantIndex(loaded);
  if (prevLastIdx < 0 || loadedLastIdx < 0) return loaded;

  const prevLast = prev[prevLastIdx];
  const loadedLast = loaded[loadedLastIdx];
  if (!prevLast || !loadedLast) return loaded;

  if (!assistantTurnVisuallyEquivalent(prevLast, loadedLast)) {
    return loaded;
  }

  if (prev.length !== loaded.length) {
    return loaded;
  }

  const usageChanged = !usageEquivalent(prevLast.usage, loadedLast.usage);
  const attachmentsChanged = !attachmentsEquivalent(prevLast.attachments, loadedLast.attachments);
  if (!usageChanged && !attachmentsChanged) {
    return prev;
  }

  const next = [...prev];
  next[prevLastIdx] = {
    ...prevLast,
    ...(usageChanged && loadedLast.usage !== undefined ? { usage: loadedLast.usage } : {}),
    ...(attachmentsChanged && loadedLast.attachments?.length
      ? { attachments: loadedLast.attachments }
      : {}),
  };
  return next;
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

  return mergeConsecutiveAssistantMessages(out);
}

function applyStripToUserContent(
  role: Message['role'],
  blocks: MessageContent[],
): MessageContent[] {
  if (role !== 'user' && role !== 'user-with-attachments') return blocks;
  const mapped = blocks.map((b) => {
    if (b.type === 'text' && typeof b.text === 'string') {
      let stripped = stripStartupContextForDisplay(b.text);
      stripped = stripExpandedAtFileBlocks(stripped);
      stripped = stripInboundFileMachineText(stripped);
      return { ...b, text: collapseExpandedSkillBlockForDisplay(stripped) };
    }
    return b;
  });
  return mapped.filter((b) => {
    if (b.type === 'text' && (!b.text || !b.text.trim())) return false;
    return true;
  });
}

function buildUserMessage(m: WireMessage): Message {
  const roleRaw = String(m.role ?? 'user');
  const role: Message['role'] =
    roleRaw === 'user' || roleRaw === 'user-with-attachments'
      ? (roleRaw)
      : 'assistant';

  const fromContent = extractAttachmentsFromUserContent(m.content);

  return {
    role,
    content: applyStripToUserContent(role, normalizeContentBlocks(m.content)),
    attachments: mergeUserAttachments(normalizeWireAttachments(m.attachments), fromContent),
    timestamp: typeof m.timestamp === 'number' ? m.timestamp : parseTs(m.timestamp),
    usage: m.usage as Message['usage'],
  };
}

function buildAssistantMessage(m: WireMessage): Message {
  const content = mergeAssistantContent(m);
  return {
    role: 'assistant',
    content,
    attachments: dedupeAttachments(normalizeWireAttachments(m.attachments)),
    timestamp: typeof m.timestamp === 'number' ? m.timestamp : parseTs(m.timestamp),
    usage: m.usage as Message['usage'],
  };
}

function mergeAssistantContent(m: WireMessage): MessageContent[] {
  const blocks = normalizeContentBlocks(m.content);

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

/** Map session/API image blocks to UI `ImageContent` (`source.data` is a usable `img` src). */
function wireImageBlockToContent(item: WireContentBlock): MessageContent | null {
  const fromSource = item.source?.data;
  if (typeof fromSource === 'string' && fromSource.length > 0) {
    return { type: 'image', source: { data: fromSource } };
  }
  const raw = item.data;
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith('data:')) {
    return { type: 'image', source: { data: trimmed } };
  }
  const mime =
    typeof item.mimeType === 'string' && item.mimeType.includes('/')
      ? item.mimeType
      : 'image/png';
  const compact = trimmed.replace(/\s/g, '');
  return { type: 'image', source: { data: `data:${mime};base64,${compact}` } };
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
      const img = wireImageBlockToContent(item);
      if (img) {
        out.push(img);
      }
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

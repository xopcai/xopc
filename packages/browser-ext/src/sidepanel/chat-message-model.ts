import { resolveToolActivity, type ToolActivity } from '@xopcai/gateway-contract';

export type BrowserTextBlock = {
  type: 'text';
  text: string;
  messageId?: string;
};

export type BrowserThinkingBlock = {
  type: 'thinking';
  text: string;
  streaming: boolean;
};

export type BrowserToolBlock = {
  type: 'tool';
  toolCallId: string;
  name: string;
  status: 'running' | 'done' | 'error';
  activity?: ToolActivity;
  input?: unknown;
  result?: unknown;
  details?: unknown;
  startedAt?: number;
  completedAt?: number;
};

export type BrowserMessageBlock = BrowserTextBlock | BrowserThinkingBlock | BrowserToolBlock;

export type BrowserChatAttachment = {
  type: 'image' | 'file';
  mimeType?: string;
  name: string;
  size?: number;
};

export type BrowserChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  blocks: BrowserMessageBlock[];
  timestamp?: number;
  attachments?: BrowserChatAttachment[];
  sourceContexts?: Array<{ kind: 'note' | 'browser_page'; title: string; url?: string; truncated?: boolean }>;
};

export function messageText(message: BrowserChatMessage): string {
  return message.blocks
    .filter((block): block is BrowserTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

export function hasMessageContent(message: BrowserChatMessage): boolean {
  return message.blocks.some((block) => block.type === 'tool' || block.text.trim().length > 0)
    || Boolean(message.attachments?.length);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function timestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function blockId(value: Record<string, unknown>, index: number): string {
  const id = value.toolCallId ?? value.tool_call_id ?? value.id;
  return typeof id === 'string' && id ? id : `tool:${index}`;
}

function parseBlocks(value: unknown, startedAt?: number): BrowserMessageBlock[] {
  if (typeof value === 'string') return value ? [{ type: 'text', text: value }] : [];
  if (!Array.isArray(value)) return [];

  return value.flatMap((item, index): BrowserMessageBlock[] => {
    const block = record(item);
    if (!block || typeof block.type !== 'string') return [];
    if (block.type === 'text' && typeof block.text === 'string') {
      return [{ type: 'text', text: block.text }];
    }
    if (block.type === 'thinking') {
      const text = typeof block.thinking === 'string'
        ? block.thinking
        : typeof block.text === 'string' ? block.text : '';
      return [{ type: 'thinking', text, streaming: false }];
    }
    if (block.type === 'tool_use' || block.type === 'tool_call' || block.type === 'toolCall') {
      const fn = record(block.function);
      const name = typeof block.name === 'string'
        ? block.name
        : typeof fn?.name === 'string' ? fn.name : 'unknown';
      const result = block.result;
      return [{
        type: 'tool',
        toolCallId: blockId(block, index),
        name,
        status: block.isError === true ? 'error' : 'done',
        input: block.input ?? block.args ?? block.arguments ?? fn?.arguments,
        result,
        details: block.details,
        activity: resolveToolActivity(name, block.isError === true ? 'failed' : 'completed', result),
        startedAt,
        completedAt: startedAt,
      }];
    }
    return [];
  });
}

function parseAttachments(value: unknown): BrowserChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): BrowserChatAttachment[] => {
    const media = record(item);
    if (!media) return [];
    const mimeType = typeof media.mimeType === 'string' ? media.mimeType : undefined;
    const name = typeof media.name === 'string' && media.name.trim() ? media.name.trim() : 'Attachment';
    return [{
      type: media.type === 'image' || media.type === 'photo' || mimeType?.startsWith('image/') ? 'image' : 'file',
      name,
      ...(mimeType ? { mimeType } : {}),
      ...(typeof media.size === 'number' && Number.isFinite(media.size) ? { size: media.size } : {}),
    }];
  });
}

function parseSourceContexts(value: unknown): BrowserChatMessage['sourceContexts'] {
  const metadata = record(value);
  if (!Array.isArray(metadata?.sourceContexts)) return undefined;
  const contexts = metadata.sourceContexts.flatMap((item): NonNullable<BrowserChatMessage['sourceContexts']> => {
    const source = record(item);
    if (!source || (source.kind !== 'note' && source.kind !== 'browser_page') || typeof source.title !== 'string') return [];
    return [{
      kind: source.kind,
      title: source.title,
      ...(typeof source.url === 'string' ? { url: source.url } : {}),
      ...(source.truncated === true ? { truncated: true } : {}),
    }];
  });
  return contexts.length ? contexts : undefined;
}

function appendDeclaredTools(blocks: BrowserMessageBlock[], row: Record<string, unknown>, startedAt?: number): void {
  const declarations = [
    ...(Array.isArray(row.tool_calls) ? row.tool_calls : []),
    ...(Array.isArray(row.toolCalls) ? row.toolCalls : []),
  ];
  for (let index = 0; index < declarations.length; index += 1) {
    const declaration = record(declarations[index]);
    if (!declaration) continue;
    const fn = record(declaration.function);
    const id = blockId(declaration, index);
    const name = typeof declaration.name === 'string'
      ? declaration.name
      : typeof fn?.name === 'string' ? fn.name : 'unknown';
    const existing = blocks.find((block): block is BrowserToolBlock => block.type === 'tool' && block.toolCallId === id);
    const result = declaration.result;
    const failed = declaration.isError === true;
    if (existing) {
      if (result !== undefined) {
        existing.status = failed ? 'error' : 'done';
        existing.result = result;
        existing.completedAt = startedAt;
      }
      existing.details = declaration.details ?? existing.details;
      continue;
    }
    blocks.push({
      type: 'tool',
      toolCallId: id,
      name,
      input: declaration.args ?? declaration.arguments ?? fn?.arguments,
      status: result === undefined ? 'running' : failed ? 'error' : 'done',
      result,
      details: declaration.details,
      activity: resolveToolActivity(name, result === undefined ? 'running' : failed ? 'failed' : 'completed', result),
      startedAt,
      ...(result === undefined ? {} : { completedAt: startedAt }),
    });
  }
}

function mergeAssistantBlocks(target: BrowserMessageBlock[], incoming: BrowserMessageBlock[]): void {
  for (const block of incoming) {
    if (block.type === 'tool') {
      const index = target.findIndex((candidate) => candidate.type === 'tool' && candidate.toolCallId === block.toolCallId);
      if (index >= 0) {
        target[index] = block;
        continue;
      }
    }
    const previous = target.at(-1);
    if (block.type === 'thinking' && previous?.type === 'thinking' && previous.text === block.text) continue;
    target.push(block);
  }
}

function applyToolResult(messages: BrowserChatMessage[], row: Record<string, unknown>): void {
  const assistant = [...messages].reverse().find((message) => message.role === 'assistant');
  if (!assistant) return;
  const id = row.toolCallId ?? row.tool_call_id;
  if (typeof id !== 'string') return;
  const tool = assistant.blocks.find((block): block is BrowserToolBlock => block.type === 'tool' && block.toolCallId === id);
  if (!tool) return;
  const result = typeof row.content === 'string'
    ? row.content
    : Array.isArray(row.content)
      ? row.content.flatMap((item) => {
          const block = record(item);
          return block?.type === 'text' && typeof block.text === 'string' ? [block.text] : [];
        }).join('')
      : '';
  const failed = row.isError === true;
  tool.status = failed ? 'error' : 'done';
  tool.result = result;
  tool.details = row.details;
  tool.completedAt = timestamp(row.timestamp);
  tool.activity = resolveToolActivity(tool.name, failed ? 'failed' : 'completed', { result, details: row.details });
}

export function normalizeChatMessages(values: readonly unknown[]): BrowserChatMessage[] {
  const messages: BrowserChatMessage[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const row = record(values[index]);
    if (!row) continue;
    if (row.role === 'tool' || row.role === 'toolResult') {
      applyToolResult(messages, row);
      continue;
    }
    if (row.role !== 'user' && row.role !== 'assistant' && row.role !== 'system') continue;
    const startedAt = timestamp(row.timestamp);
    const rawBlocks = parseBlocks(row.rawContent, startedAt);
    const blocks = rawBlocks.length ? rawBlocks : parseBlocks(row.content, startedAt);
    if (row.role === 'assistant') appendDeclaredTools(blocks, row, startedAt);
    const attachments = [...parseAttachments(row.media), ...parseAttachments(row.attachments)];
    const sourceContexts = parseSourceContexts(row.metadata);
    const message: BrowserChatMessage = {
      id: typeof row.id === 'string' ? row.id : `${row.role}:${index}`,
      role: row.role,
      blocks,
      ...(startedAt === undefined ? {} : { timestamp: startedAt }),
      ...(attachments.length ? { attachments } : {}),
      ...(sourceContexts ? { sourceContexts } : {}),
    };
    if (!hasMessageContent(message)) continue;
    const previous = messages.at(-1);
    if (message.role === 'assistant' && previous?.role === 'assistant') {
      mergeAssistantBlocks(previous.blocks, message.blocks);
      previous.timestamp = message.timestamp ?? previous.timestamp;
      if (message.attachments?.length) previous.attachments = [...(previous.attachments ?? []), ...message.attachments];
    } else {
      messages.push(message);
    }
  }
  return messages;
}

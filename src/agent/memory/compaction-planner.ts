import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { estimateTextTokens } from './context-budget.js';
import { readAgentMessageContent } from './agent-message-access.js';

export interface CompactionUnit {
  messages: AgentMessage[];
  text: string;
  estimatedTokens: number;
}

export interface CompactionChunk {
  text: string;
  estimatedTokens: number;
  messageCount: number;
  oversized: boolean;
}

function safeJson(value: unknown, maxChars = 8_000): string {
  let text: string;
  try {
    text = JSON.stringify(value, (_key, nested) => {
      if (typeof nested === 'string' && nested.length > 4_000) {
        return `${nested.slice(0, 2_000)}\n… [${nested.length - 4_000} chars omitted] …\n${nested.slice(-2_000)}`;
      }
      return nested;
    });
  } catch {
    text = String(value);
  }
  if (text.length <= maxChars) return text;
  const half = Math.floor((maxChars - 80) / 2);
  return `${text.slice(0, half)}\n… [structured value truncated] …\n${text.slice(-half)}`;
}

function valueRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function serializeContentBlock(block: unknown): string {
  const record = valueRecord(block);
  if (!record) return safeJson(block);
  const type = String(record.type ?? 'unknown');
  if (type === 'text') return String(record.text ?? '');
  if (type === 'toolCall') {
    return [
      '[Tool call]',
      `name: ${String(record.name ?? 'unknown')}`,
      `id: ${String(record.id ?? record.toolCallId ?? 'unknown')}`,
      `arguments: ${safeJson(record.arguments ?? record.args ?? {})}`,
    ].join('\n');
  }
  if (type === 'image' || type === 'audio' || type === 'video' || type === 'file') {
    const metadata = { ...record };
    delete metadata.data;
    delete metadata.bytes;
    delete metadata.base64;
    return `[${type} content]\nmetadata: ${safeJson(metadata, 2_000)}`;
  }
  if (type === 'thinking' || type === 'reasoning' || type === 'reasoning_details') {
    return '[Assistant private reasoning omitted from compaction input]';
  }
  return `[${type} block]\n${safeJson(record)}`;
}

export function serializeMessageForCompaction(message: AgentMessage): string {
  const record = message as unknown as Record<string, unknown>;
  const raw = readAgentMessageContent(message);
  const content = typeof raw === 'string'
    ? raw
    : Array.isArray(raw)
      ? raw.map(serializeContentBlock).filter(Boolean).join('\n\n')
      : safeJson(raw);
  const metadata: string[] = [];
  if (message.role === 'toolResult') {
    metadata.push(`tool: ${String(record.toolName ?? 'unknown')}`);
    metadata.push(`toolCallId: ${String(record.toolCallId ?? 'unknown')}`);
    metadata.push(`status: ${record.isError === true ? 'error' : 'success'}`);
    if (record.details != null) metadata.push(`details: ${safeJson(record.details, 4_000)}`);
  }
  return [`### ${message.role}`, ...metadata, content].filter(Boolean).join('\n');
}

function toolCallIds(message: AgentMessage): Set<string> {
  if (message.role !== 'assistant') return new Set();
  const raw = readAgentMessageContent(message);
  if (!Array.isArray(raw)) return new Set();
  const ids = new Set<string>();
  for (const block of raw) {
    const record = valueRecord(block);
    if (record?.type !== 'toolCall') continue;
    const id = record.id ?? record.toolCallId;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

function isMatchingToolResult(message: AgentMessage, ids: ReadonlySet<string>): boolean {
  if (message.role !== 'toolResult') return false;
  const id = (message as unknown as { toolCallId?: unknown }).toolCallId;
  return typeof id === 'string' && ids.has(id);
}

export function buildCompactionUnits(messages: readonly AgentMessage[]): CompactionUnit[] {
  const units: CompactionUnit[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const group = [messages[index]!];
    const ids = toolCallIds(messages[index]!);
    if (ids.size > 0) {
      while (index + 1 < messages.length && isMatchingToolResult(messages[index + 1]!, ids)) {
        index += 1;
        group.push(messages[index]!);
      }
    }
    const text = group.map(serializeMessageForCompaction).join('\n\n');
    units.push({ messages: group, text, estimatedTokens: estimateTextTokens(text) + 16 });
  }
  return units;
}

function truncateOversizedUnit(text: string, maxTokens: number): string {
  const maxChars = Math.max(800, maxTokens * 4);
  if (text.length <= maxChars) return text;
  const marker = `\n\n[Oversized atomic message group: ${text.length - maxChars} characters omitted from the middle]\n\n`;
  const side = Math.max(200, Math.floor((maxChars - marker.length) / 2));
  return `${text.slice(0, side)}${marker}${text.slice(-side)}`;
}

export function planCompactionChunks(
  messages: readonly AgentMessage[],
  maxChunkTokens: number,
): CompactionChunk[] {
  const chunks: CompactionChunk[] = [];
  let parts: string[] = [];
  let tokens = 0;
  let messageCount = 0;

  const flush = () => {
    if (parts.length === 0) return;
    chunks.push({ text: parts.join('\n\n'), estimatedTokens: tokens, messageCount, oversized: false });
    parts = [];
    tokens = 0;
    messageCount = 0;
  };

  for (const unit of buildCompactionUnits(messages)) {
    if (unit.estimatedTokens > maxChunkTokens) {
      flush();
      const text = truncateOversizedUnit(unit.text, maxChunkTokens);
      chunks.push({
        text,
        estimatedTokens: estimateTextTokens(text),
        messageCount: unit.messages.length,
        oversized: true,
      });
      continue;
    }
    if (tokens > 0 && tokens + unit.estimatedTokens > maxChunkTokens) flush();
    parts.push(unit.text);
    tokens += unit.estimatedTokens;
    messageCount += unit.messages.length;
  }
  flush();
  return chunks;
}

const IDENTIFIER_PATTERNS = [
  /https?:\/\/[^\s)>]+/gi,
  /(?<![\w:/])\/(?:[\w.@-]+\/)*[\w.@-]+/g,
  /(?<![\w./-])(?:[\w.@-]+\/)+[\w.@-]+\.[a-z0-9]{1,10}\b/gi,
  /\b(?:release|feature|fix|hotfix|bugfix|chore)\/[\w.@-]+\b/gi,
  /\b[0-9a-f]{8,64}\b/gi,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\bport\s+\d{2,5}\b/gi,
] as const;

export function extractExactIdentifiers(messages: readonly AgentMessage[], limit = 12): string[] {
  const text = messages.map(serializeMessageForCompaction).join('\n');
  const matches: Array<{ identifier: string; index: number }> = [];
  for (const pattern of IDENTIFIER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const identifier = match[0].trim();
      if (identifier.length < 4 || match.index == null) continue;
      matches.push({ identifier, index: match.index });
    }
  }
  matches.sort((left, right) => left.index - right.index);

  const found = new Set<string>();
  for (const { identifier } of matches) {
    found.add(identifier);
    if (found.size >= limit) break;
  }
  return [...found];
}

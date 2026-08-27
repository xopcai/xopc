import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { readAgentMessageContent } from './agent-message-access.js';

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
    return `[${type} content]\nmetadata: ${safeJson(metadata)}`;
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
    if (record.details != null) metadata.push(`details: ${safeJson(record.details)}`);
  }
  return [`### ${message.role}`, ...metadata, content].filter(Boolean).join('\n');
}

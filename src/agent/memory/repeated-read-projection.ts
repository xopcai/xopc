import { createHash } from 'node:crypto';

import { CONTEXT_LIMIT_TRUNCATION_NOTICE } from '../embedded/tool-result-context-guard.js';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

const readProjectionDetails = Symbol('readProjectionDetails');

/** Preserve host-only completeness evidence across provider hygiene without putting it on the wire. */
export function retainReadProjectionDetails<T extends { role: string }>(source: readonly T[]): T[] {
  return source.map(message => {
    const receipt = record(message);
    return message.role === 'toolResult' && (receipt.toolName === 'read_file' || receipt.toolName === 'web_fetch')
      ? { ...message, [readProjectionDetails]: receipt.details } : message;
  });
}

/** Run after ID hygiene and budget pruning, retaining each execution receipt and its surviving body. */
export function projectRepeatedReadResults<T extends { role: string; content?: unknown }>(source: readonly T[]): T[] {
  const calls = new Map<string, { name: string; arguments: unknown; index: number }>();
  for (let index = source.length - 1; index >= 0; index--) {
    const message = source[index];
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const value of message.content) {
      const block = record(value);
      if (block.type === 'toolCall' && typeof block.id === 'string'
        && (block.name === 'read_file' || block.name === 'web_fetch') && block.arguments && typeof block.arguments === 'object') {
        calls.set(block.id, { name: block.name, arguments: block.arguments, index });
      }
    }
  }
  const retained = new Map<string, string>();
  const result = [...source];
  for (let index = source.length - 1; index >= 0; index--) {
    const message = source[index];
    const receipt = record(message);
    if (message.role !== 'toolResult' || receipt.isError || typeof receipt.toolCallId !== 'string'
      || !Array.isArray(message.content) || message.content.length === 0) continue;
    const call = calls.get(receipt.toolCallId);
    const details = record(receipt.details ?? (message as T & { [readProjectionDetails]?: unknown })[readProjectionDetails]);
    if (!call || call.index >= index || call.name !== receipt.toolName || details.error || details.code
      || (details.status !== undefined && !['ok', 'success', 'completed', 'passed'].includes(String(details.status)))) continue;
    const complete = call.name === 'read_file'
      ? details.truncated === false && typeof details.path === 'string' && typeof details.offset === 'number'
      : details.complete === true && details.truncated === false && typeof details.url === 'string';
    if (!complete || message.content.some(value => record(value).type !== 'text' || typeof record(value).text !== 'string')) continue;
    if (message.content.some(value => (record(value).text as string).includes(CONTEXT_LIMIT_TRUNCATION_NOTICE))) continue;
    const textLength = message.content.reduce((size, value) => size + (record(value).text as string).length, 0);
    if (textLength <= 1024) continue;
    const key = createHash('sha256').update(JSON.stringify([call.name, call.arguments, details, message.content])).digest('hex');
    const later = retained.get(key);
    if (!later) { retained.set(key, receipt.toolCallId); continue; }
    const text = `[Earlier successful ${call.name} response duplicates retained tool result ${JSON.stringify(later)} (same request and response). Use that full body. This receipt records its own execution; the reference is not a new read or verification.]`;
    if (text.length + 256 < textLength) result[index] = { ...message, content: [{ type: 'text', text }] };
  }
  return result.map(message => {
    if (!(readProjectionDetails in message)) return message;
    const { [readProjectionDetails]: _details, ...clean } = message as T & { [readProjectionDetails]?: unknown };
    return clean as T;
  });
}

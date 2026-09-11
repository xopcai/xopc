import { createHash } from 'node:crypto';

import type { BrowserPageContextInput } from '@xopcai/gateway-contract';

import type { AgentSourceContext } from './types.js';

function canonicalPayload(input: BrowserPageContextInput) {
  const url = new URL(input.url);
  url.username = '';
  url.password = '';
  url.hash = '';
  return {
    title: input.title.trim(),
    url: url.toString(),
    capturedAt: input.capturedAt,
    documentId: input.documentId.trim(),
    selection: input.selection?.trim() || undefined,
    text: input.text?.trim() || undefined,
  };
}

export function browserPageContextToAgentContext(input: BrowserPageContextInput): AgentSourceContext {
  const payload = canonicalPayload(input);
  const version = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const parts = [
    `Page title: ${payload.title}`,
    `Page URL: ${payload.url}`,
    payload.selection ? `Selected text:\n${payload.selection}` : undefined,
    payload.text ? `Page text:\n${payload.text}` : undefined,
  ].filter((value): value is string => Boolean(value));
  return {
    kind: 'browser_page',
    sourceId: input.sourceId,
    version,
    title: payload.title,
    text: parts.join('\n\n'),
    url: payload.url,
    capturedAt: payload.capturedAt,
    documentId: payload.documentId,
    truncated: input.truncated,
  };
}

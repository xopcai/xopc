import { stripRuntimeUserMessageEnvelope } from '@xopcai/gateway-contract';

import { stripSessionStartupContextFromUserText } from '../agent/reply/startup-context.js';

/** Client-facing form of a persisted model-facing user message. */
export function stripRuntimeContextFromUserMessage(text: string): string {
  return stripRuntimeUserMessageEnvelope(stripSessionStartupContextFromUserText(text));
}

/** Preserve structured content while cleaning every user text block. */
export function stripRuntimeContextFromUserContent(content: string | unknown[]): string | unknown[] {
  if (typeof content === 'string') return stripRuntimeContextFromUserMessage(content);
  return content.map((block) => {
    if (!block || typeof block !== 'object') return block;
    const row = block as { type?: unknown; text?: unknown };
    if (row.type !== 'text' || typeof row.text !== 'string') return block;
    return { ...row, text: stripRuntimeContextFromUserMessage(row.text) };
  });
}

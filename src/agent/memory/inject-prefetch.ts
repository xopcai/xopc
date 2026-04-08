import type { AgentMessage } from '@mariozechner/pi-agent-core';

import { buildMemoryContextBlock } from './context-fence.js';
import type { MemoryManager } from './manager.js';

/**
 * Prefix user message with fenced prefetched memory context (if any).
 */
export async function injectPrefetchIntoUserMessage(
  memoryManager: MemoryManager,
  sessionKey: string,
  userMessage: AgentMessage,
  queryText: string,
): Promise<AgentMessage> {
  const q = queryText.trim();
  if (!q) {
    return userMessage;
  }

  const raw = await memoryManager.prefetchAll(q, { sessionId: sessionKey });
  const block = buildMemoryContextBlock(raw);
  if (!block.trim()) {
    return userMessage;
  }

  const prefix = `${block}\n\n`;
  const c = userMessage.content;

  if (typeof c === 'string') {
    return { ...userMessage, content: prefix + c } as AgentMessage;
  }

  if (Array.isArray(c) && c.length > 0) {
    const first = c[0] as { type?: string; text?: string };
    if (first?.type === 'text' && typeof first.text === 'string') {
      const copy = [...c];
      copy[0] = { type: 'text', text: prefix + first.text };
      return { ...userMessage, content: copy } as AgentMessage;
    }
    return {
      ...userMessage,
      content: [{ type: 'text' as const, text: prefix }, ...c],
    } as AgentMessage;
  }

  return userMessage;
}

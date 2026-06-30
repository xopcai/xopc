import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { readAgentMessageContent } from './agent-message-access.js';
import { MemoryContextAssembler } from './context-assembler.js';
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

  const block = await new MemoryContextAssembler().assemble({
    memoryManager,
    sessionKey,
    query: q,
  });
  if (!block.trim()) {
    return userMessage;
  }

  const prefix = `${block}\n\n`;
  const c = readAgentMessageContent(userMessage);

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

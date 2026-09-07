import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { readAgentMessageContent } from '../memory/agent-message-access.js';

export function prependAgentContext(message: AgentMessage, block: string): AgentMessage {
  if (!block) return message;
  const prefix = `${block}\n\n`;
  const content = readAgentMessageContent(message);
  if (typeof content === 'string') return { ...message, content: prefix + content } as AgentMessage;
  if (!Array.isArray(content)) return message;
  const copy = [...content];
  const first = copy[0] as { type?: string; text?: string } | undefined;
  if (first?.type === 'text' && typeof first.text === 'string') {
    copy[0] = { type: 'text', text: prefix + first.text };
  } else {
    copy.unshift({ type: 'text', text: prefix });
  }
  return { ...message, content: copy } as AgentMessage;
}

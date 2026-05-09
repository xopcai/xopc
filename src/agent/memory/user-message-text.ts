import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { extractTextContent } from '../context/workspace.js';

/** Plain text from a user-role agent message (string or parts array). */
export function extractAgentUserPlainText(message: AgentMessage): string {
  const c = message.content;
  if (typeof c === 'string') {
    return c;
  }
  if (Array.isArray(c)) {
    return extractTextContent(c as Array<{ type: string; text?: string }>);
  }
  return '';
}

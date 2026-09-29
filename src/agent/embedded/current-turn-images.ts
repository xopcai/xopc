import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent } from '@earendil-works/pi-ai';

/** The session projection stores media refs, so restore current-turn images for provider requests. */
export function restoreCurrentTurnImages(
  messages: AgentMessage[],
  images: readonly ImageContent[],
  turnId: string,
): AgentMessage[] {
  if (images.length === 0) return messages;

  let userIndex = messages.findLastIndex(message =>
    message.role === 'user' && (message as { turnId?: string }).turnId === turnId);
  if (userIndex < 0) userIndex = messages.findLastIndex(message => message.role === 'user');
  if (userIndex < 0) return messages;

  const user = messages[userIndex] as Extract<AgentMessage, { role: 'user' }>;
  const content = typeof user.content === 'string'
    ? [{ type: 'text' as const, text: user.content }]
    : user.content;
  if (content.some(block => block.type === 'image')) return messages;

  const next = [...messages];
  next[userIndex] = { ...user, content: [...content, ...images] };
  return next;
}

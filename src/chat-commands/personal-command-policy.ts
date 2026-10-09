import { isPersonalConversation } from '../personal-agent/repository.js';

/** Personal conversations expose only reply cancellation through the command system. */
export function personalCommandRejection(conversationId: string, commandId: string, name: string): string | undefined {
  if (!isPersonalConversation(conversationId) || commandId === 'session.abort') return undefined;
  return `Personal AI does not support /${name}. Describe your request directly; manage capabilities and preferences in settings.`;
}

import { SessionManager } from './session-manager';
import { patchSessionAgentConfigView } from './patch-session-agent-config-view';
import { MessageSender } from '../messages/message-sender';
import type { WireAttachment } from '../composer/composer.types';

/** Auxiliary entry points use the same draft/outbox protocol as the chat composer. */
export async function sendSessionInput(conversationId: string, content: string, attachments?: WireAttachment[]): Promise<void> {
  const manager = new SessionManager();
  const config = await manager.loadSessionAgentConfig(conversationId);
  await manager.loadSession(conversationId);
  patchSessionAgentConfigView(conversationId, config);
  await new MessageSender().send(content, conversationId, attachments, config.thinkingLevel);
}

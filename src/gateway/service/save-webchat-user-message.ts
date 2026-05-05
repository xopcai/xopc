import { createLogger } from '../../utils/logger.js';

import type { SessionManager } from '../../session/index.js';

const log = createLogger('GatewayService');

export async function saveWebchatUserMessage(
  sessionManager: SessionManager,
  sessionKey: string,
  message: string,
  attachments?: Array<{
    type: string;
    mimeType?: string;
    data?: string;
    name?: string;
    size?: number;
    workspaceRelativePath?: string;
  }>,
): Promise<void> {
  const existingMessages = await sessionManager.loadMessages(sessionKey);

  const userMessage = {
    role: 'user' as const,
    content: [{ type: 'text' as const, text: message }],
    attachments: attachments?.map((a) => ({
      type: a.type,
      mimeType: a.mimeType,
      name: a.name,
      size: a.size,
      workspaceRelativePath: a.workspaceRelativePath,
    })),
    timestamp: Date.now(),
    webchatEarlySave: true as const,
  };

  const updatedMessages = [...existingMessages, userMessage];
  await sessionManager.saveMessages(sessionKey, updatedMessages);
  log.debug({ sessionKey, messageCount: updatedMessages.length }, 'User message saved');
}

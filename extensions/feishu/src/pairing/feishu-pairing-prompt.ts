import { createLogger } from '@xopcai/xopc/utils/logger.js';
import {
  issuePairingChallenge,
  resolveStandardPairingPath,
} from '@xopcai/xopc/channels/pairing/index.js';

import { createFeishuClient } from '../transport/client/client.js';
import type { ResolvedFeishuAccount } from '../state/accounts.js';

const log = createLogger('FeishuPairing');

/**
 * When DM policy is `pairing` and the user is not yet allowlisted, send a one-time pairing code + CLI hint.
 */
export async function sendFeishuPairingPromptIfNeeded(params: {
  account: ResolvedFeishuAccount;
  messageId: string;
  threadId?: string;
  senderId: string;
  senderName?: string;
  isGroup: boolean;
}): Promise<void> {
  if (params.isGroup) return;
  const { account, messageId, threadId, senderId, senderName } = params;
  if (!messageId.trim() || !senderId.trim()) return;

  try {
    const { api } = createFeishuClient(account);
    await issuePairingChallenge({
      channel: 'feishu',
      pairingFilePath: resolveStandardPairingPath('feishu', account.accountId),
      accountId: account.accountId,
      senderId,
      senderIdLine: `Your Feishu sender id: ${senderId}`,
      meta: senderName ? { displayName: senderName } : undefined,
      sendPairingReply: async (text) => {
        await (api as any).im.message.reply({
          path: { message_id: messageId },
          data: {
            msg_type: 'text',
            content: JSON.stringify({ text }),
            ...(threadId ? { reply_in_thread: true } : {}),
          },
        });
      },
      onCreated: ({ code }) => {
        log.info({ accountId: account.accountId, senderId, code }, 'Feishu pairing code issued');
      },
      onReplyError: (err) => {
        log.warn({ err, accountId: account.accountId, senderId }, 'Feishu pairing reply failed');
      },
    });
  } catch (err) {
    log.warn({ err, accountId: account.accountId, senderId }, 'Feishu pairing prompt failed');
  }
}

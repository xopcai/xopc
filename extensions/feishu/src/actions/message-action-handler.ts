import type { ChannelMessageActionContext } from '@xopcai/xopc/channels/plugin-types.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

const log = createLogger('FeishuActions');

/**
 * Hook for Feishu interactive cards (`card.action.trigger`) before the agent turn runs.
 * Extend here for toasts, card updates, or audit — keep side effects bounded and fast.
 */
export async function handleFeishuChannelMessageAction(ctx: ChannelMessageActionContext): Promise<void> {
  log.info(
    {
      action: ctx.action,
      accountId: ctx.accountId,
      chatId: ctx.chatId,
      messageId: ctx.messageId,
      dataPreview:
        typeof ctx.data === 'string' && ctx.data.length > 400 ? `${ctx.data.slice(0, 400)}…` : ctx.data,
    },
    'Feishu interactive card action',
  );
}

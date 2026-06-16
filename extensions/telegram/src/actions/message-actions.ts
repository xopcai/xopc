import type { ChannelMessageActionContext } from '@xopcai/xopc/channels/plugin-types.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

const log = createLogger('TelegramActions');

/** Placeholder for Telegram-native message actions (react/edit/delete/poll). */
export async function handleTelegramChannelAction(ctx: ChannelMessageActionContext): Promise<void> {
  log.debug({ action: ctx.action }, 'Telegram message action (not yet wired to agent tools)');
}

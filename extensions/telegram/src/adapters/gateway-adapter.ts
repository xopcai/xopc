import type {
  ChannelGatewayAdapter,
  ChannelGatewayContext,
} from '@xopcai/xopcbot/channels/plugin-types.js';
import type { TelegramResolvedAccount } from './types.js';

export function createTelegramGatewayAdapter(handlers: {
  startAccount: (account: TelegramResolvedAccount) => Promise<void>;
  stopAccount: (accountId: string) => Promise<void>;
}): ChannelGatewayAdapter<TelegramResolvedAccount> {
  return {
    startAccount: async (ctx: ChannelGatewayContext<TelegramResolvedAccount>) => {
      await handlers.startAccount(ctx.account);
    },
    stopAccount: async (ctx: ChannelGatewayContext<TelegramResolvedAccount>) => {
      await handlers.stopAccount(ctx.accountId);
    },
  };
}

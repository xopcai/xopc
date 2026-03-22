import type { Config } from '../../../../config/index.js';
import type {
  ChannelSecurityAdapter,
  ChannelSecurityContext,
} from '../../../../channels/plugin-types.js';
import { evaluateAccess, resolveDmPolicy, resolveGroupPolicy } from '../../../../channels/security.js';
import type { DmPolicy, GroupPolicy } from '../../../../channels/channel-domain.js';
import type { TelegramResolvedAccount } from './types.js';

export function createTelegramSecurityAdapter(): ChannelSecurityAdapter<TelegramResolvedAccount> {
  return {
    resolveDmPolicy: ({ account }) => resolveDmPolicy(account.dmPolicy as DmPolicy | undefined, 'open'),
    resolveGroupPolicy: ({ account }) =>
      resolveGroupPolicy(account.groupPolicy as GroupPolicy | undefined, 'open'),
    resolveAllowFrom: ({ account }) => account.allowFrom,
    checkAccess: (ctx: ChannelSecurityContext, account, _cfg: Config) => {
      const isGroup = ctx.isGroup;
      const allowFrom = isGroup
        ? (account.groupAllowFrom ?? account.allowFrom ?? [])
        : (account.allowFrom ?? []);
      const result = evaluateAccess({
        context: {
          channel: 'telegram',
          accountId: account.accountId,
          chatId: ctx.chatId,
          senderId: ctx.senderId,
          senderName: ctx.senderName,
          isGroup,
          isDm: !isGroup,
        },
        dmPolicy: account.dmPolicy as DmPolicy | undefined,
        groupPolicy: account.groupPolicy as GroupPolicy | undefined,
        allowFrom,
        groupAllowFrom: account.groupAllowFrom,
      });
      return { allowed: result.allowed, reason: result.reason };
    },
  };
}

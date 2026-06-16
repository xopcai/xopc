import type { Config } from '@xopcai/xopc/config/index.js';
import type {
  ChannelSecurityAdapter,
  ChannelSecurityContext,
} from '@xopcai/xopc/channels/plugin-types.js';
import { readAllowFromIdsSync, resolveStandardAllowFromPath } from '@xopcai/xopc/channels/pairing/index.js';
import { evaluateAccess, resolveDmPolicy, resolveGroupPolicy } from '@xopcai/xopc/channels/security.js';
import type { DmPolicy, GroupPolicy } from '@xopcai/xopc/channels/channel-domain.js';
import type { TelegramResolvedAccount } from './types.js';

export function createTelegramSecurityAdapter(): ChannelSecurityAdapter<TelegramResolvedAccount> {
  return {
    resolveDmPolicy: ({ account }) => resolveDmPolicy(account.dmPolicy as DmPolicy | undefined, 'pairing'),
    resolveGroupPolicy: ({ account }) =>
      resolveGroupPolicy(account.groupPolicy as GroupPolicy | undefined, 'open'),
    resolveAllowFrom: ({ account }) => account.allowFrom,
    checkAccess: (ctx: ChannelSecurityContext, account, _cfg: Config) => {
      const isGroup = ctx.isGroup;
      const storeAllow = !isGroup
        ? readAllowFromIdsSync(resolveStandardAllowFromPath('telegram', account.accountId))
        : [];
      const allowFrom = isGroup
        ? (account.groupAllowFrom ?? account.allowFrom ?? [])
        : [...(account.allowFrom ?? []), ...storeAllow];
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
        allowNameMatching: true,
      });
      return { allowed: result.allowed, reason: result.reason };
    },
  };
}

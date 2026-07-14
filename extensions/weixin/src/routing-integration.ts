import type { Config } from '@xopcai/xopc/config/schema.js';
import { resolveRoute } from '@xopcai/xopc/routing/index.js';

export type WeixinRoutingContext = {
  accountId: string;
  senderId: string;
};

/** Resolve a direct-message session key through the shared channel binding rules. */
export function generateWeixinSessionKeyWithRouting(
  context: WeixinRoutingContext,
  config: Config,
): string {
  return resolveRoute({
    config,
    channel: 'weixin',
    accountId: context.accountId,
    peerKind: 'dm',
    peerId: context.senderId,
  }).sessionKey;
}

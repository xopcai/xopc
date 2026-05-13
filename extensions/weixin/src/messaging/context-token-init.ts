import { toRawIlinkUserIdForApi } from '../auth/weixin-account-id.js';
import { getConfig } from '../api/api.js';
import type { ResolvedWeixinAccount } from '../auth/accounts.js';
import { logger } from '../util/logger.js';

import { getContextToken, getWeixinOutboundSendUserId, setContextToken } from './inbound.js';

/**
 * When there is no cached context_token (e.g. cron before any inbound in this process),
 * try ilink getconfig — some deployments return context_token for the given ilink_user_id.
 */
export async function ensureWeixinContextTokenForOutbound(
  accountId: string,
  userId: string,
  account: Pick<ResolvedWeixinAccount, 'baseUrl' | 'token' | 'routeTag'>,
): Promise<string | undefined> {
  const cached = getContextToken(accountId, userId);
  if (cached) return cached;
  if (!account.token?.trim()) return undefined;

  try {
    const ilinkUserId =
      getWeixinOutboundSendUserId(accountId, userId)?.trim() || toRawIlinkUserIdForApi(userId);
    const resp = await getConfig({
      baseUrl: account.baseUrl,
      token: account.token,
      routeTag: account.routeTag,
      ilinkUserId,
      contextToken: undefined,
    });
    if (resp.ret != null && resp.ret !== 0) {
      logger.debug(
        { userId, accountId, ret: resp.ret, errmsg: resp.errmsg },
        'ensureWeixinContextTokenForOutbound: getConfig returned error',
      );
      return undefined;
    }
    const t = resp.context_token?.trim();
    if (t) {
      setContextToken(accountId, userId, t);
      logger.info(
        { userId, accountId },
        'ensureWeixinContextTokenForOutbound: stored context_token from getConfig',
      );
      return t;
    }
  } catch (e) {
    logger.debug({ err: e, userId, accountId }, 'ensureWeixinContextTokenForOutbound: getConfig failed');
  }
  return undefined;
}

import { createHash } from 'node:crypto';

import { DEFAULT_BASE_URL, loadWeixinAccount } from '../../../extensions/weixin/src/auth/accounts.js';

/** An opaque login revision; never expose the channel credential or silently rebind a recipient. */
export function weixinAccountIdentityRevision(accountId: string): string | undefined {
  const account = loadWeixinAccount(accountId);
  if (!account?.token?.trim()) return;
  return createHash('sha256').update(JSON.stringify([account.userId ?? '', account.token.trim(), account.baseUrl?.trim() || DEFAULT_BASE_URL])).digest('hex');
}

import type { Config } from '@xopcai/xopc/config/schema.js';

import { resolveFeishuAccount } from '../state/accounts.js';
import { createFeishuClient } from '../transport/client/client.js';

export async function feishuWhoAmI(params: { cfg: Config; accountId?: string }): Promise<any> {
  const account = resolveFeishuAccount(params.cfg, params.accountId ?? 'default');
  if (!account.configured) {
    throw new Error('Feishu account not configured');
  }
  const { api } = createFeishuClient(account);
  const res = await (api as any).auth.tenantAccessToken.internal({
    data: {
      app_id: account.appId,
      app_secret: account.appSecret,
    },
  });
  return { ok: true, tenantAccessToken: Boolean(res?.tenant_access_token || res?.data?.tenant_access_token) };
}


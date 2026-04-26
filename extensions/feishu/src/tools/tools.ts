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
  const token = res?.tenant_access_token || res?.data?.tenant_access_token || '';

  // Probe a few representative APIs to surface which permission buckets are working.
  // Keep it cheap: one lightweight call per area, each isolated so partial failures still return signal.
  const probes: Record<string, { ok: boolean; error?: string }> = {};

  const tryProbe = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      probes[name] = { ok: true };
    } catch (err) {
      probes[name] = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  await tryProbe('im.message.read', async () => {
    // A harmless endpoint that validates the token; will still fail if permissions missing.
    await (api as any).im.v1.chat.list({ params: { page_size: 1 } });
  });

  await tryProbe('drive.files.list', async () => {
    await (api as any).drive.v1.file.list({ params: { page_size: 1 } });
  });

  await tryProbe('wiki.spaces.list', async () => {
    await (api as any).wiki.v2.space.list({ params: { page_size: 1 } });
  });

  await tryProbe('bitable.apps.list', async () => {
    await (api as any).bitable.v1.app.list({ params: { page_size: 1 } });
  });

  return {
    ok: true,
    tenantAccessToken: Boolean(token),
    probes,
  };
}


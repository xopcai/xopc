import type { ResolvedFeishuAccount } from '../../state/accounts.js';
import { resolveFeishuBaseUrl } from './client.js';

export async function probeFeishuBot(account: Pick<ResolvedFeishuAccount, 'appId' | 'appSecret' | 'domain'>, signal = AbortSignal.timeout(10_000)) {
  const baseUrl = resolveFeishuBaseUrl(account.domain);
  if (!baseUrl || !account.appId || !account.appSecret) return { ok: false as const };
  const authResponse = await fetch(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: account.appId, app_secret: account.appSecret }),
    redirect: 'error',
    signal,
  });
  if (!authResponse.ok) return { ok: false as const };
  const auth = await authResponse.json() as { code?: number; tenant_access_token?: string };
  if (auth.code !== 0 || !auth.tenant_access_token) return { ok: false as const };
  const infoResponse = await fetch(`${baseUrl}/open-apis/bot/v3/info`, {
    headers: { Authorization: `Bearer ${auth.tenant_access_token}` },
    redirect: 'error',
    signal,
  });
  if (!infoResponse.ok) return { ok: false as const };
  const info = await infoResponse.json() as { code?: number; bot?: { app_name?: string; open_id?: string } };
  if (info.code !== 0 || !info.bot?.open_id) return { ok: false as const };
  return { ok: true as const, name: info.bot.app_name, openId: info.bot.open_id };
}

import type { DingtalkConfig } from './config-schema.js';

const DINGTALK_API = 'https://api.dingtalk.com';

type CachedToken = { token: string; expiryMs: number };
const apiTokenCache = new Map<string, CachedToken>();

function cacheKey(config: Pick<DingtalkConfig, 'clientId'>): string {
  const clientId = String(config.clientId ?? '').trim();
  if (!clientId) {
    throw new Error('DingTalk clientId is required for token');
  }
  return clientId;
}

export async function getDingtalkAccessToken(config: Pick<DingtalkConfig, 'clientId' | 'clientSecret'>): Promise<string> {
  const now = Date.now();
  const key = cacheKey(config);
  const cached = apiTokenCache.get(key);
  if (cached && cached.expiryMs > now + 60_000) {
    return cached.token;
  }

  const endpoint = `${DINGTALK_API}/v1.0/oauth2/accessToken`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appKey: config.clientId,
      appSecret: config.clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as { accessToken?: string; expireIn?: number };
  const token = String(data.accessToken ?? '').trim();
  if (!token) {
    throw new Error(`DingTalk accessToken missing: HTTP ${res.status}`);
  }
  const expireInSec = Number(data.expireIn ?? 7200);
  apiTokenCache.set(key, {
    token,
    expiryMs: now + expireInSec * 1000,
  });
  return token;
}

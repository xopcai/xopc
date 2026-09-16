import { constants, createHash, createPrivateKey, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { NotificationTarget } from '@xopcai/gateway-contract';

type ServiceAccount = { project_id: string; key_id: string; sub_account: string; private_key: string };
type PushCategory = 'WORK' | 'IM' | 'MARKETING';
export type HarmonyPushConfig = { accountFile: string; category: PushCategory; testMessage: boolean };
export type HarmonyNotification = { pushToken: string; eventId: string; title: string; body?: string; gatewayId?: string; target?: NotificationTarget };

export function harmonyPushConfig(env: NodeJS.ProcessEnv = process.env): HarmonyPushConfig | undefined {
  const accountFile = env.XOPC_HARMONY_PUSH_SERVICE_ACCOUNT?.trim();
  const category = env.XOPC_HARMONY_PUSH_CATEGORY;
  if (!accountFile || !isAbsolute(accountFile) || !['WORK', 'IM', 'MARKETING'].includes(category ?? '')) return undefined;
  return { accountFile, category: category as PushCategory, testMessage: env.XOPC_HARMONY_PUSH_TEST_MESSAGE === 'true' };
}

export function createHarmonyPushJwt(account: ServiceAccount, now = Date.now()): string {
  if (!/^\d+$/.test(account.project_id) || !account.key_id || !account.sub_account || !account.private_key) {
    throw new Error('Invalid Harmony push service account');
  }
  const key = createPrivateKey(account.private_key);
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
    throw new Error('Harmony push requires an RSA service account key of at least 2048 bits');
  }
  const iat = Math.floor(now / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'PS256', typ: 'JWT', kid: account.key_id })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: account.sub_account,
    aud: 'https://oauth-login.cloud.huawei.com/oauth2/v3/token', iat, exp: iat + 3600 })).toString('base64url');
  const input = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(input), {
    key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString('base64url');
  return `${input}.${signature}`;
}

/** Uses HarmonyOS V3 service-account authentication, not the Android HMS OAuth flow. */
export async function sendHarmonyPush(
  notification: HarmonyNotification,
  fetchImpl: typeof fetch = fetch,
  config: HarmonyPushConfig | undefined = harmonyPushConfig(),
): Promise<string> {
  if (!config) throw new Error('Harmony push is not configured');
  let account: ServiceAccount;
  let jwt: string;
  try {
    account = JSON.parse(await readFile(config.accountFile, 'utf8')) as ServiceAccount;
    jwt = createHarmonyPushJwt(account);
  } catch {
    // Never include file contents, private keys, or provider responses in logs.
    throw new Error('Harmony push service account could not be loaded');
  }
  const notifyId = createHash('sha256').update(notification.eventId).digest().readUInt32BE(0) & 0x7fffffff;
  const navigation = notification.gatewayId && notification.target ? Buffer.from(JSON.stringify({
    gatewayId: notification.gatewayId, eventId: notification.eventId, target: notification.target,
  })).toString('base64url') : undefined;
  const response = await fetchImpl(`https://push-api.cloud.huawei.com/v3/${account.project_id}/messages:send`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, 'push-type': '0' },
    body: JSON.stringify({
      payload: { notification: { category: config.category, title: notification.title.slice(0, 100),
        body: (notification.body || notification.title).slice(0, 200),
        clickAction: navigation ? { actionType: 1, uri: `xopc://notification#p=${navigation}` } : { actionType: 0 },
        foregroundShow: false, notifyId } },
      target: { token: [notification.pushToken] },
      pushOptions: { testMessage: config.testMessage, ttl: 86400 },
    }),
  });
  if (!response.ok) throw new Error(`Harmony push request failed (${response.status})`);
  const result = await response.json() as { code?: string; requestId?: string };
  if (result.code !== '80000000' || typeof result.requestId !== 'string' || !result.requestId) {
    const code = typeof result.code === 'string' && /^\d{8}$/.test(result.code) ? result.code : 'invalid_response';
    throw new Error(`Harmony push rejected (${code})`);
  }
  return result.requestId;
}

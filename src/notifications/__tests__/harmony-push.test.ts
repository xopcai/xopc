import { constants, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHarmonyPushJwt, harmonyPushConfig, sendHarmonyPush } from '../harmony-push.js';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = { project_id: '123456', key_id: 'test-key', sub_account: 'test-account',
  private_key: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() };
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function config() {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-harmony-push-')); dirs.push(dir);
  const accountFile = join(dir, 'account.json'); writeFileSync(accountFile, JSON.stringify(account), { mode: 0o600 });
  return { accountFile, category: 'WORK' as const, testMessage: true };
}
const message = { pushToken: 'private-device-token', eventId: 'event-1', title: 'Work ready', body: 'Open xopc' };

describe('HarmonyOS V3 push adapter', () => {
  it('requires an absolute credential file and an explicitly configured category', () => {
    expect(harmonyPushConfig({})).toBeUndefined();
    expect(harmonyPushConfig({ XOPC_HARMONY_PUSH_SERVICE_ACCOUNT: 'relative', XOPC_HARMONY_PUSH_CATEGORY: 'WORK' })).toBeUndefined();
    expect(harmonyPushConfig({ XOPC_HARMONY_PUSH_SERVICE_ACCOUNT: '/private/account.json', XOPC_HARMONY_PUSH_CATEGORY: 'WORK' }))
      .toEqual({ accountFile: '/private/account.json', category: 'WORK', testMessage: false });
  });
  it('signs a verifiable PS256 service-account JWT with one-hour lifetime', () => {
    const token = createHarmonyPushJwt(account, 1_700_000_000_000);
    const [header, payload, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'PS256', typ: 'JWT', kid: 'test-key' });
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toEqual({ iss: 'test-account',
      aud: 'https://oauth-login.cloud.huawei.com/oauth2/v3/token', iat: 1_700_000_000, exp: 1_700_003_600 });
    expect(verify('sha256', Buffer.from(`${header}.${payload}`), { key: keys.publicKey,
      padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(signature!, 'base64url'))).toBe(true);
  });
  it('uses V3, stable notification IDs, bounded TTL, and no redirects', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ code: '80000000', requestId: 'request-1' })));
    const options = config();
    expect(await sendHarmonyPush(message, fetchMock, options)).toBe('request-1');
    await sendHarmonyPush(message, fetchMock, options);
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://push-api.cloud.huawei.com/v3/123456/messages:send');
    expect(request?.redirect).toBe('error');
    expect(request?.headers).toMatchObject({ 'push-type': '0' });
    const body = JSON.parse(request?.body as string);
    expect(body).toMatchObject({ target: { token: [message.pushToken] }, payload: { notification: { category: 'WORK', foregroundShow: false } }, pushOptions: { testMessage: true, ttl: 86400 } });
    expect(body.payload.notification.notifyId).toBe(JSON.parse(fetchMock.mock.calls[1]![1]?.body as string).payload.notification.notifyId);
  });
  it('does not mistake partial acceptance for success or leak response tokens in errors', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: '80100000', msg: message.pushToken })));
    await expect(sendHarmonyPush(message, fetchMock, config())).rejects.toThrow('Harmony push rejected (80100000)');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openXopcDatabase, closeXopcDatabase } from '../../../../storage/sqlite/connection.js';
import { createHonoApp } from '../../app.js';
import { ConfigSchema } from '../../../../config/schema.js';
import type { GatewayService } from '../../../service.js';
import { buckets } from '../../../rate-limit/index.js';

const credential = 'owner-credential-for-test';
const origin = 'https://test.frp.xopc.ai';
const baseHeaders = { Host: 'test.frp.xopc.ai', Origin: origin };
let auth = { mode: 'token' as const, token: credential };
let app: ReturnType<typeof createHonoApp>;
const disconnect = vi.fn();
function service(): GatewayService {
  return { currentConfig: ConfigSchema.parse({ gateway: { port: 18790, corsOrigins: [origin], auth } }),
    getResolvedAuth: () => auth, getEffectiveListenPort: () => 18790, getHealth: () => ({ status: 'healthy' }),
    realtime: { disconnectPrincipal: disconnect }, voiceRealtime: { disconnectPrincipal: disconnect },
  } as unknown as GatewayService;
}
async function login() {
  const response = await app.request(`${origin}/api/browser-session`, { method: 'POST', headers: { ...baseHeaders, Authorization: `Bearer ${credential}` } });
  expect(response.status).toBe(200);
  return response;
}
describe('browser session real Hono and lazy route integration', () => {
  beforeEach(() => { openXopcDatabase({ path: ':memory:' }); buckets.resetAllForTests(); auth = { mode: 'token', token: credential }; app = createHonoApp({ service: service() }); disconnect.mockClear(); });
  afterEach(() => { closeXopcDatabase(); buckets.resetAllForTests(); });
  it('exchanges credentials for a secure host-only HttpOnly cookie without returning a secret', async () => {
    const response = await login();
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('__Host-xopc-session=');
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Domain=');
    const body = await response.json();
    expect(body.conversationId).toMatch(/^browser:/);
    expect(JSON.stringify(body)).not.toContain(credential);
    const authenticated = await app.request(`${origin}/api/browser-session`, { headers: { ...baseHeaders, Cookie: cookie.split(';')[0] } });
    expect(authenticated.status).toBe(200);
    expect(await authenticated.json()).toEqual(body);
    const share = await app.request(`${origin}/api/shares`, { method: 'POST', headers: { ...baseHeaders, Cookie: cookie.split(';')[0], 'Content-Type': 'application/json' }, body: '{}' });
    expect(share.status).toBe(400);
  });
  it('rejects cross-origin cookies, missing Origin mutations and query credentials', async () => {
    const response = await login(); const cookie = response.headers.get('set-cookie')!.split(';')[0];
    for (const headers of [{ Host: baseHeaders.Host, Cookie: cookie }, { ...baseHeaders, Origin: 'https://other.frp.xopc.ai', Cookie: cookie }]) {
      expect((await app.request(`${origin}/api/browser-session`, { method: 'DELETE', headers })).status).toBe(403);
    }
    expect((await app.request(`${origin}/api/browser-session?token=${credential}`, { headers: baseHeaders })).status).toBe(401);
  });
  it('rejects sessions after credential rotation and disconnects realtime on logout', async () => {
    const response = await login(); const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const headers = { ...baseHeaders, Cookie: cookie };
    expect((await app.request(`${origin}/api/browser-session`, { method: 'DELETE', headers })).status).toBe(200);
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect((await app.request(`${origin}/api/browser-session`, { headers })).status).toBe(401);
    const next = await login(); auth = { mode: 'token', token: 'rotated' };
    expect((await app.request(`${origin}/api/browser-session`, { headers: { ...baseHeaders, Cookie: next.headers.get('set-cookie')!.split(';')[0] } })).status).toBe(401);
  });
});

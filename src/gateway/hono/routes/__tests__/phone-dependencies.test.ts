import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ install: vi.fn(), status: vi.fn(async () => []), probe: vi.fn(), busy: false }));
vi.mock('../../../../runtime-tools/phone-dependencies.js', async () => {
  const { EventEmitter } = await import('node:events');
  return { PhoneDependencyManager: class extends EventEmitter { status = fixture.status; install = fixture.install; }, probePhoneAdb: fixture.probe };
});
vi.mock('../../../../phone/runtime.js', () => ({ getPhoneRuntime: () => ({ reports: () => fixture.busy ? [{ status: 'paused' }] : [] }) }));

import { ConfigSchema } from '../../../../config/schema.js';
import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import { registerPhoneDependencyRoutes } from '../phone-dependencies.js';

function app(admin = true) {
  fixture.busy = false; fixture.install.mockReset(); fixture.probe.mockReset();
  const app = new Hono(); const saveConfig = vi.fn(async () => ({ saved: true }));
  app.use('*', async (c, next) => { setGatewayPrincipal(c, { kind: admin ? 'owner' : 'device', principalId: 'test', scopes: ['gateway.admin'] }); await next(); });
  registerPhoneDependencyRoutes(app, { service: { currentConfig: ConfigSchema.parse({}), saveConfig, emit: vi.fn() }, strictRateLimitMiddleware: async (_c, next) => next() } as never);
  return { app, saveConfig };
}
it('requires administrator access even if a paired device knows the installation endpoints', async () => {
  const denied = app(false).app;
  for (const [path, method] of [['', 'GET'], ['/adb/path', 'POST'], ['/scrcpy/install/stream', 'POST']]) {
    expect((await denied.request(`/api/runtime-tools/phone-dependencies${path}`, { method, body: method === 'POST' ? '{}' : undefined })).status).toBe(403);
  }
  expect(fixture.install).not.toHaveBeenCalled();
});
it('returns readiness without installing and streams an explicit successful installation', async () => {
  const { app: ready } = app();
  expect((await ready.request('/api/runtime-tools/phone-dependencies')).status).toBe(200); expect(fixture.install).not.toHaveBeenCalled();
  const response = await ready.request('/api/runtime-tools/phone-dependencies/scrcpy/install/stream', { method: 'POST', body: '{}' });
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  expect(await response.text()).toContain('"ok":true'); expect(fixture.install).toHaveBeenCalledWith('scrcpy', expect.objectContaining({ repair: false }));
});
it('refuses ADB changes during a phone session and validates a custom path before saving', async () => {
  const { app: ready, saveConfig } = app(); fixture.busy = true;
  const request = () => ready.request('/api/runtime-tools/phone-dependencies/adb/path', { method: 'POST', body: JSON.stringify({ path: '/gateway/tools/adb' }) });
  expect((await request()).status).toBe(409); expect(saveConfig).not.toHaveBeenCalled();
  fixture.busy = false; fixture.probe.mockRejectedValueOnce(new Error('Invalid adb'));
  expect((await request()).status).toBe(400); expect(saveConfig).not.toHaveBeenCalled();
  expect((await request()).status).toBe(200); expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ phone: expect.objectContaining({ adbPath: '/gateway/tools/adb' }) }));
});
it('rejects unknown dependencies and does not turn failed installs into success results', async () => {
  const { app: ready } = app();
  expect((await ready.request('/api/runtime-tools/phone-dependencies/unknown/install/stream', { method: 'POST', body: '{}' })).status).toBe(400);
  fixture.install.mockRejectedValueOnce(new Error('checksum mismatch'));
  const response = await ready.request('/api/runtime-tools/phone-dependencies/scrcpy/install/stream', { method: 'POST', body: '{}' });
  expect(await response.text()).toContain('"ok":false');
});

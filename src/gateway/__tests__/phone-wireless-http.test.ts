import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { WirelessPhones } from '../../phone/wireless.js';
import { PhoneRuntime } from '../../phone/runtime.js';
import { PhoneRepository } from '../../phone/repository.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('pairs, registers and reconnects through an authenticated running Gateway and lazy bundle', async () => {
  closeXopcDatabase(); openXopcDatabase({ path: ':memory:' });
  const token = 'wireless-http-test-token';
  let port = 40001;
  let online = false;
  let guid = 'adb-test-guid';
  const command = vi.fn(async (_path: string, args: string[]) => {
    if (args[0] === 'mdns') return Buffer.from(args[1] === 'check' ? 'Openscreen discovery' : `${guid} _adb-tls-connect._tcp 192.168.1.5:${port}`);
    if (args[0] === 'pair') return Buffer.from('Successfully paired');
    if (args[0] === 'connect') { online = true; return Buffer.from(`connected to ${args[1]}`); }
    if (args[0] === 'devices') return Buffer.from(`List of devices attached\n${online ? `192.168.1.5:${port} device model:Phone` : ''}`);
    return Buffer.from(args.includes('ro.serialno') ? 'hardware-one' : guid);
  });
  const wireless = new WirelessPhones(command, 2);
  const driver = { discover: vi.fn(async () => online ? [{ serial: `192.168.1.5:${port}`, state: 'device', name: 'Phone', emulator: false }] : []), observe: vi.fn(), execute: vi.fn() };
  const runtime = new PhoneRuntime(new PhoneRepository(), () => driver, undefined, undefined, wireless);
  const runtimeModule = await import('../../phone/runtime.js');
  vi.spyOn(runtimeModule, 'getPhoneRuntime').mockReturnValue(runtime);
  const app = createHonoApp({ service: {
    currentConfig: ConfigSchema.parse({ phone: { enabled: true }, gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
    isGatewayReady: () => true, getExtensionLoader: () => null,
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const request = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => fetch(`${base}/api/phone${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    expect((await fetch(`${base}/api/phone/wireless/discovery`)).status).toBe(401);
    const discovery = await request('/wireless/discovery'); expect(discovery.status).toBe(200); expect(discovery.headers.get('cache-control')).toBe('no-store');
    const qr = await request('/wireless/pairings', { method: 'qr' });
    expect(qr.status).toBe(201); const qrSession = (await qr.json()).payload;
    expect(qrSession.qrPayload).toMatch(/^WIFI:T:ADB;S:studio-[a-f0-9]+;P:[a-f0-9]+;;$/);
    expect((await request(`/wireless/pairings/${qrSession.id}`, undefined, 'DELETE')).status).toBe(200);
    expect((await request(`/wireless/pairings/${qrSession.id}`)).status).toBe(404);
    expect((await request('/wireless/pairings', { method: 'code', host: '8.8.8.8', pairingPort: 1234, code: '123456' })).status).toBe(400);
    expect((await request('/wireless/pairings', { method: 'code', host: '192.168.1.5', pairingPort: 1234, code: '123' })).status).toBe(400);
    const created = await request('/wireless/pairings', { method: 'code', host: '192.168.1.5', pairingPort: 39123, code: '012345' });
    expect(created.status).toBe(201); const session = (await created.json()).payload;
    await vi.waitFor(async () => expect((await (await request(`/wireless/pairings/${session.id}`)).json()).payload.status).toBe('connected'));
    const added = await request('/devices', { serial: '192.168.1.5:40001', name: 'My phone', appAccess: 'selected', allowedApps: ['com.android.settings'] });
    const addedBody = await added.json(); expect(added.status, JSON.stringify(addedBody)).toBe(201); const device = addedBody.payload;
    expect(device.wireless).toMatchObject({ guid, hardwareSerial: 'hardware-one' });
    expect((await request(`/wireless/pairings/${session.id}`, undefined, 'DELETE')).status).toBe(200);
    online = false; port = 40002;
    const reconnected = await request(`/devices/${device.id}/reconnect`, {});
    expect(reconnected.status).toBe(200);
    expect((await reconnected.json()).payload).toMatchObject({ id: device.id, serial: '192.168.1.5:40002', name: 'My phone', appAccess: 'selected', allowedApps: ['com.android.settings'] });
    // Refresh-driven recovery must preserve the same registration as well.
    online = false; port = 40003;
    expect((await request('/devices')).status).toBe(200);
    expect(runtime.repository.get(device.id).serial).toBe('192.168.1.5:40003');
    guid = 'other-phone';
    const mismatch = await request(`/devices/${device.id}/reconnect`, { host: '192.168.1.5', port: 40003 });
    expect(mismatch.status).toBe(400);
    expect(runtime.repository.get(device.id).wireless?.guid).toBe('adb-test-guid');
    expect((await fetch(`${base}/api/phone-wireless/pairings`, { headers })).status).toBe(404);
  } finally {
    await runtime.shutdown();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    vi.restoreAllMocks(); closeXopcDatabase();
  }
}, 30_000);

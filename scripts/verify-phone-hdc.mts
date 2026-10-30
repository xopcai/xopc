/** USB-only acceptance. Default: read-only HTTP checks. --actions exercises basic Settings input and restores the original app. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';

import { ConfigSchema } from '../src/config/schema.js';
import { AgentDefaultsSchema } from '../src/agent-config/schema.js';
import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase } from '../src/storage/sqlite/connection.js';
import { HdcPhoneDriver, resolveHdcPath } from '../src/phone/hdc-driver.js';
import { getPhoneRuntime } from '../src/phone/runtime.js';
import { createHonoApp } from '../src/gateway/hono/app.js';
import type { GatewayService } from '../src/gateway/service.js';

const state = await mkdtemp(join(tmpdir(), 'xopc-hdc-verify-'));
Object.assign(process.env, { XOPC_STATE_DIR: state, XOPC_WORKSPACE: state, XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false' });
openXopcDatabase({ path: ':memory:' });
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: 'chat/model' } } }), agents: [{ id: 'main', enabled: true, workspace: state }] });
const token = randomUUID(); const hdcPath = resolveHdcPath(process.env.XOPC_PHONE_HDC_PATH);
const config = ConfigSchema.parse({ phone: { enabled: true, hdcPath }, gateway: { auth: { mode: 'token', token } } });
const runtime = getPhoneRuntime();
const app = createHonoApp({ service: { currentConfig: config, isGatewayReady: () => true, getExtensionLoader: () => null,
  getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
  sessions: { emit: () => {}, getSession: async () => null } } as unknown as GatewayService });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
if (!server.listening) await once(server, 'listening');
const address = server.address(); assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}/api/phone`;
async function request(path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, body === undefined ? 200 : path === '/devices' ? 201 : 200, `${path}: ${response.status}`);
  return (await response.json()).payload;
}
try {
  assert.equal((await fetch(`${base}/devices?platform=harmonyos`)).status, 401);
  const discovery = await request('/devices?platform=harmonyos');
  const phone = discovery.discovery.find((d: { serial: string; state: string }) => d.state === 'device' && (!process.env.XOPC_PHONE_HDC_SERIAL || d.serial === process.env.XOPC_PHONE_HDC_SERIAL));
  assert(phone, 'Connect and authorize a HarmonyOS USB phone first');
  const device = await request('/devices', { platform: 'harmonyos', serial: phone.serial, name: 'HarmonyOS acceptance', allowedApps: [], appAccess: 'all', textInput: 'manual' });
  assert.equal((await request(`/devices/${device.id}/diagnostics`, {})).state, 'device');
  assert((await request(`/devices/${device.id}/apps`)).applications.length > 0);
  const screen = await fetch(`${base}/devices/${device.id}/screen`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(screen.status, 200); assert.equal(screen.headers.get('cache-control'), 'no-store');
  const pixels = Buffer.from(await screen.arrayBuffer()); assert.equal(pixels.subarray(1, 4).toString(), 'PNG'); pixels.fill(0);
  await request(`/devices/${device.id}/view`, {});
  const live = await request(`/conversations/${encodeURIComponent(`device:${device.id}`)}?clientId=${randomUUID()}`);
  assert(['snapshot', 'hdc-h264'].includes(live.media)); assert.equal(live.textInput, 'manual');
  await request(`/devices/${device.id}/disconnect`, {});
  let actions = 0;
  if (process.argv.includes('--actions')) {
    const driver = new HdcPhoneDriver(hdcPath); const signal = AbortSignal.timeout(60_000);
    const original = await driver.observe(phone.serial, signal);
    try {
      await driver.execute(phone.serial, { type: 'launch', package: 'com.huawei.hmos.settings' }, original, signal); actions++;
      let settings = await driver.observe(phone.serial, signal);
      try {
        assert.equal(settings.package, 'com.huawei.hmos.settings');
        await driver.execute(phone.serial, { type: 'swipe', start: [800, 800], end: [800, 250], durationMs: 600 }, settings, signal); actions++;
        settings.frame.fill(0); settings = await driver.observe(phone.serial, signal);
        assert.equal(settings.package, 'com.huawei.hmos.settings');
        // Tap the inert title area, avoiding switches, accounts and actions in the list.
        await driver.execute(phone.serial, { type: 'tap', point: [500, 50] }, settings, signal); actions++;
        const fresh = await driver.observe(phone.serial, signal);
        try { assert.equal(fresh.package, 'com.huawei.hmos.settings'); }
        finally { fresh.frame.fill(0); }
        await driver.execute(phone.serial, { type: 'back' }, settings, signal); actions++;
        await driver.execute(phone.serial, { type: 'home' }, settings, signal); actions++;
      } finally { settings.frame.fill(0); }
    } finally {
      try { await driver.execute(phone.serial, { type: 'launch', package: original.package }, original, AbortSignal.timeout(15_000)); }
      finally { original.frame.fill(0); }
    }
  }
  console.log(JSON.stringify({ passed: true, usb: true, authenticatedHttp: true, png: true, snapshotPanel: true, actions, modelRequests: 0 }));
} finally {
  await runtime.shutdown(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  closeXopcDatabase(); await rm(state, { recursive: true, force: true });
}

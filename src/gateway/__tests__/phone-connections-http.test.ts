import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { AgentDefaultsSchema } from '../../agent-config/schema.js';
import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { MOCK_PHONE_MODEL } from '../../phone/contracts.js';
import { PhoneRepository } from '../../phone/repository.js';
import { PhoneRuntime } from '../../phone/runtime.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import { getSessionMetadata } from '../../storage/sqlite/session-read-repository.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('exposes persistent device connections and contention through a running authenticated Gateway', async () => {
  closeXopcDatabase(); openXopcDatabase({ path: ':memory:' });
  initializeTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: 'chat/model' }, phoneUse: { primary: MOCK_PHONE_MODEL } } }) });
  const token = 'phone-connections-test-token';
  const config = ConfigSchema.parse({ phone: { enabled: true }, gateway: { auth: { mode: 'token', token } } });
  const repository = new PhoneRepository();
  const device = repository.save({ serial: 'emulator-5554', name: 'Shared phone', enabled: true, allowedApps: ['com.android.settings'] });
  repository.setDefault(device.id);
  const driver = {
    discover: vi.fn(async () => [{ serial: device.serial, name: 'Phone', state: 'device', emulator: true }]),
    observe: vi.fn(async () => ({ frameId: randomUUID(), capturedAt: Date.now(), width: 100, height: 200, rotation: 0, package: 'com.android.settings', frame: Buffer.from('pixels'), elements: [] })),
    execute: vi.fn(),
  };
  const runtime = new PhoneRuntime(repository, () => driver, async () => ({ predict: async () => ({ kind: 'complete', summary: 'Done' }) }));
  const runtimeModule = await import('../../phone/runtime.js');
  vi.spyOn(runtimeModule, 'getPhoneRuntime').mockReturnValue(runtime);
  const chatA = randomUUID(); const chatB = randomUUID();
  const context = { config, agentId: 'main', modelRef: MOCK_PHONE_MODEL };
  const app = createHonoApp({ service: {
    currentConfig: config, getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
    isGatewayReady: () => true, getExtensionLoader: () => null,
    sessions: { emit: vi.fn(), getSession: async (id: string) => ({ agentId: 'main', name: id === chatA ? 'Chat A' : 'Chat B' }) },
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const request = (path: string, body?: unknown) => fetch(`${base}/api/phone${path}`, { headers, method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    expect((await fetch(`${base}/api/phone/connections`)).status).toBe(401);
    await runtime.execute(chatA, { op: 'open', mode: 'control' }, context);
    const list = await request('/connections'); expect(list.status).toBe(200); expect(list.headers.get('cache-control')).toBe('no-store');
    const [report] = (await list.json()).payload;
    expect(report).toMatchObject({ deviceId: device.id, owner: chatA, sourceConversationName: 'Chat A' });
    const modePath = `/conversations/${chatA}/${report.sessionId}/execution-mode`;
    expect((await fetch(`${base}/api/phone${modePath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    const mode = await request(modePath, { executionMode: 'direct', epoch: report.controlEpoch, clientId: randomUUID() });
    expect(mode.status).toBe(200);
    expect(await mode.json()).toMatchObject({ payload: { report: { nextExecutionMode: 'direct' } } });
    expect(repository.executionMode(chatA)).toBe('direct');
    const staleMode = await request(modePath, { executionMode: 'collaborative', epoch: report.controlEpoch + 50, clientId: randomUUID() });
    expect(staleMode.status).toBe(409);
    expect((await request(`/conversations/${encodeURIComponent(`device:${device.id}`)}/${report.sessionId}/execution-mode`, { executionMode: 'direct', epoch: report.controlEpoch, clientId: randomUUID() })).status).toBe(403);
    const busy = await request('/sessions', { deviceId: device.id, mode: 'control' });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ error: { code: 'PHONE_DEVICE_BUSY', executionStarted: false, occupancy: { conversationId: chatA }, retryPolicy: 'user_initiated' } });
    const path = `/conversations/${encodeURIComponent(`device:${device.id}`)}`;
    expect((await request(`/devices/${device.id}/view`, {})).status).toBe(200);
    const screen = await request(`/devices/${device.id}/screen`); expect(screen.status).toBe(200);
    expect(runtime.status(chatA)).toMatchObject({ controlOwner: 'agent', sessionId: report.sessionId });
    const refused = await request(`${path}/${report.sessionId}/control`, { clientId: randomUUID(), operationId: randomUUID(), epoch: report.controlEpoch, op: 'cancel' });
    expect(refused.status).toBe(403); expect(await refused.json()).toMatchObject({ error: { code: 'PHONE_OBSERVE_ONLY' } });
    const created = await request(`/devices/${device.id}/conversations`, {}); expect(created.status).toBe(201);
    const createdId = (await created.json()).payload.conversationId;
    expect(getSessionMetadata(createdId)).toMatchObject({ customData: { phoneDeviceId: device.id }, name: device.name });
    expect(runtime.status(chatA)).toMatchObject({ controlOwner: 'agent' });
    const stopped = await request(`/conversations/${chatA}/${report.sessionId}/control`, { clientId: randomUUID(), operationId: randomUUID(), epoch: report.controlEpoch, op: 'cancel' });
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toMatchObject({ payload: { report: { status: 'ready', controlOwner: 'none' } } });
    await runtime.execute(chatB, { op: 'open', mode: 'control' }, context);
    const live = await request(`${path}?clientId=${randomUUID()}`); expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ payload: { report: { sessionId: report.sessionId, owner: chatB } } });
    expect(driver.discover).toHaveBeenCalledOnce();
    expect((await request(`/devices/${device.id}/disconnect`, {})).status).toBe(200);
    expect((await (await request('/connections')).json()).payload).toEqual([]);
    expect((await fetch(`${base}/api/phone-connections`, { headers })).status).toBe(404);
  } finally {
    await runtime.shutdown(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    vi.restoreAllMocks(); closeXopcDatabase();
  }
}, 30_000);

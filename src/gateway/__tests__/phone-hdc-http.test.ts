import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { AgentDefaultsSchema } from '../../agent-config/schema.js';
import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { type PhoneModelAdapter, buildPhoneModelContext, parseAutoGlmResponse } from '../../phone/model-adapter.js';
import { PhoneError, type PhoneObservation } from '../../phone/contracts.js';
import { PhoneRepository } from '../../phone/repository.js';
import { PhoneRuntime } from '../../phone/runtime.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('registers, observes and operates a USB HarmonyOS phone through authenticated lazy routes', async () => {
  closeXopcDatabase(); openXopcDatabase({ path: ':memory:' });
  initializeTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: 'chat/model' }, phoneUse: { primary: 'test/phone' } } }) });
  vi.spyOn(await import('../../phone/hdc-video-tools.js'), 'resolveHdcVideoTools').mockReturnValue(undefined);
  const token = randomUUID();
  const config = ConfigSchema.parse({ phone: { enabled: true, hdcPath: '/test/hdc' }, gateway: { auth: { mode: 'token', token } } });
  const repo = new PhoneRepository();
  const adb = { discover: vi.fn(async () => []), observe: vi.fn(), execute: vi.fn() };
  const screen = (): PhoneObservation => ({ platform: 'harmonyos', frameId: randomUUID(), capturedAt: Date.now(), width: 100, height: 200, rotation: 0,
    package: 'com.huawei.hmos.settings', frame: Buffer.from('png-pixels'), elements: [] });
  const hdc = {
    discover: vi.fn(async () => [{ serial: 'USB-HDC', name: 'Huawei', state: 'device', emulator: false, platform: 'harmonyos' as const }]),
    observe: vi.fn(async () => screen()), execute: vi.fn(async (_serial: string, action: import('../../phone/contracts.js').PhoneAction) => {
      if (action.type === 'typeText') throw new PhoneError('PHONE_TEXT_INPUT_UNAVAILABLE', 'Type on phone', 409);
    }), applications: vi.fn(async () => [{ packageName: 'com.huawei.hmos.settings', label: 'com.huawei.hmos.settings' }]),
  };
  const factory = vi.fn(() => hdc);
  const predict = vi.fn<PhoneModelAdapter['predict']>(async () => ({ kind: 'action', action: { type: 'back' } }));
  const interactive = vi.fn();
  const runtime = new PhoneRuntime(repo, () => adb, async () => ({ predict }), interactive, undefined, factory, () => ({
    descriptor: { kind: 'hdc-h264', protocolVersion: 1, continuousTouch: false, maxPointers: 1 }, geometry: { width: 0, height: 0, version: 0, codec: '' },
    foreground: async () => 'com.huawei.hmos.settings', start: async () => { throw new PhoneError('PHONE_HDC_VIDEO_DEPENDENCY', 'Test dependency missing'); },
    subscribe: () => () => {}, pointer: async () => {}, refresh: () => {}, revoke: async () => {}, close: async () => {},
  }));
  vi.spyOn(await import('../../phone/runtime.js'), 'getPhoneRuntime').mockReturnValue(runtime);
  const app = createHonoApp({ service: { currentConfig: config, getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
    sessions: { getSession: async () => null }, emit: vi.fn() } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
  const base = `http://127.0.0.1:${address.port}/api/phone`;
  const request = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    expect((await fetch(`${base}/devices?platform=harmonyos`)).status).toBe(401);
    const discovery = await request('/devices?platform=harmonyos');
    expect(await discovery.json()).toMatchObject({ payload: { discovery: [{ platform: 'harmonyos', serial: 'USB-HDC' }] } });
    expect(adb.discover).not.toHaveBeenCalled();
    const spoof = await request('/devices', { serial: 'USB-HDC', name: 'Wrong platform' }); expect(spoof.status).toBe(400);
    const registered = await request('/devices', { serial: 'USB-HDC', name: 'Huawei', platform: 'harmonyos', allowedApps: ['com.huawei.hmos.settings'] });
    expect(registered.status).toBe(201); const device = (await registered.json()).payload;
    expect(repo.get(device.id).platform).toBe('harmonyos');
    expect((await request(`/devices/${device.id}`, { platform: 'android' }, 'PATCH')).status).toBe(400);
    expect((await request('/apps?serial=USB-HDC&platform=harmonyos')).status).toBe(200);
    expect((await request(`/devices/${device.id}/screen`)).status).toBe(200);
    hdc.observe.mockResolvedValueOnce({ ...screen(), package: 'com.denied.app' });
    expect((await request(`/devices/${device.id}/screen`)).status).toBe(400);
    const context = { config, agentId: 'main', modelRef: 'test/phone' };
    const owner = randomUUID();
    await runtime.execute(owner, { op: 'open', deviceId: device.id, mode: 'control' }, context);
    const report = runtime.status(owner)!;
    const state = runtime.liveStatus(owner, report.sessionId, context, 'client');
    expect(state).toMatchObject({ media: 'snapshot', textInput: 'manual' });
    await expect(runtime.liveVideo(owner, report.sessionId, context)).rejects.toMatchObject({ code: 'PHONE_HDC_VIDEO_DEPENDENCY' });
    expect(interactive).not.toHaveBeenCalled();
    await runtime.execute(owner, { op: 'step', goal: 'Go back', maxActions: 1 }, context);
    expect(hdc.execute).toHaveBeenCalledWith('USB-HDC', { type: 'back' }, expect.anything(), expect.any(AbortSignal), undefined);
    expect(adb.execute).not.toHaveBeenCalled();
    predict.mockResolvedValue({ kind: 'action', action: { type: 'typeText', text: 'hello' } });
    await runtime.execute(owner, { op: 'run', goal: 'Enter text', maxActions: 1 }, context);
    expect(runtime.status(owner)).toMatchObject({ status: 'needs_user', stopReason: 'text_input_required', actions: 1 });
    expect(hdc.execute).toHaveBeenCalledOnce();
    expect(buildPhoneModelContext({ goal: 'Read', observation: screen(), history: [], allowedApps: [] })).toMatchObject({ platform: 'harmonyos', textInput: expect.stringContaining('manual') });
    expect(parseAutoGlmResponse('do(action="Launch", app="设置")', ['com.huawei.hmos.settings'], { observation: screen() })).toMatchObject({ action: { package: 'com.huawei.hmos.settings' } });
    expect(factory).toHaveBeenCalledWith('/test/hdc');
  } finally {
    await runtime.shutdown(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    vi.restoreAllMocks(); closeXopcDatabase();
  }
}, 30_000);

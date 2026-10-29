import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AgentDefaultsSchema } from '../../../../agent-config/schema.js';
import { MOCK_PHONE_MODEL } from '../../../../phone/contracts.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { initializeTestAgentCatalog, seedTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../../storage/sqlite/connection.js';
import { PhoneRepository } from '../../../../phone/repository.js';
import { PhoneRuntime } from '../../../../phone/runtime.js';
import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { registerPhoneRoutes } from '../phone.js';
import { phoneAssistance, queuePhoneAssistance, requirePhoneAssistance } from '../../../../phone/assistance.js';
import type { PhoneModelAdapter } from '../../../../phone/model-adapter.js';
import { ensureSessionRecord } from '../../../../storage/sqlite/session-repository.js';
import { readCurrentTranscriptId } from '../../../../storage/sqlite/session-instance-repository.js';
import { getSqliteDatabase } from '../../../../storage/sqlite/transaction.js';
import { getSessionInputState } from '../../../../storage/sqlite/session-input-repository.js';

beforeEach(() => { closeXopcDatabase(); openXopcDatabase({ path: ':memory:' }); seedTestAgentCatalog(); });
afterEach(() => closeXopcDatabase());

function fixture(admin = true, adapter?: PhoneModelAdapter) {
  const app = new Hono();
  app.use('*', async (c, next) => { setGatewayPrincipal(c, { kind: admin ? 'owner' : 'device', principalId: 'test', scopes: ['gateway.admin'] }); await next(); });
  const driver = { discover: vi.fn(async () => [{ serial: 'emulator-5554', name: 'Emulator', state: 'device', emulator: true }]), applications: vi.fn(async () => [{ packageName: 'com.android.settings', label: '设置' }, { packageName: 'com.android.deskclock', label: '时钟' }]), textInputStatus: vi.fn(async () => ({ androidSdk: 31, unicode: 'available' as const, method: 'scrcpy-clipboard' as const, keyboardRequired: false as const })), observe: vi.fn(), execute: vi.fn() };
  const conversationId = randomUUID();
  const config = ConfigSchema.parse({ phone: { enabled: true } });
  const runtime = new PhoneRuntime(new PhoneRepository(), () => driver, adapter ? async () => adapter : undefined);
  const phoneStreams = { issue: vi.fn(() => ({ ticket: 'one-use-ticket', path: '/api/phone/live/v1/ws' })) };
  const resumePhoneAssistance = vi.fn((owner: string, waitId: string) => { queuePhoneAssistance(owner, waitId); });
  registerPhoneRoutes(app, { service: { currentConfig: config, phoneStreams, resumePhoneAssistance, sessions: { getActiveRun: () => ({ active: true }), getSession: async (id: string) => id === conversationId ? { agentId: 'main', transcriptId: readCurrentTranscriptId(getSqliteDatabase(), id) } : null }, submitSessionInput: vi.fn(async () => ({ ok: true })) }, strictRateLimitMiddleware: async (_c, next) => next() } as unknown as AuthenticatedRouteDeps, runtime);
  return { app, runtime, driver, conversationId, config, phoneStreams, resumePhoneAssistance };
}

async function assistanceFixture() {
  const f = fixture(true, { predict: async () => ({ kind: 'needsUser', reason: 'Complete login on the phone' }) });
  initializeTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: 'chat/model' }, phoneUse: { primary: 'test/phone' } } }) });
  ensureSessionRecord(f.conversationId, '.', { agentId: 'main', sourceChannel: 'webchat' });
  f.driver.observe.mockImplementation(async () => ({ frameId: randomUUID(), capturedAt: Date.now(), width: 100, height: 200, rotation: 0,
    package: 'com.android.settings', frame: Buffer.from('private-pixels'), elements: [] }));
  const device = f.runtime.repository.save({ serial: 'emulator-5554', name: 'Phone', enabled: true, appAccess: 'all', allowedApps: [] });
  const context = { config: f.config, agentId: 'main', modelRef: 'test/phone',
    onNeedsUser: (checkpoint: Parameters<typeof requirePhoneAssistance>[3]) => requirePhoneAssistance(f.conversationId, 'old-run', 'call', checkpoint).id };
  await f.runtime.execute(f.conversationId, { op: 'open', deviceId: device.id, mode: 'control' }, context);
  await f.runtime.execute(f.conversationId, { op: 'run', goal: 'Read orders', maxActions: 2 }, context);
  const report = f.runtime.status(f.conversationId)!;
  const path = `/api/phone/conversations/${f.conversationId}/${report.sessionId}/control`;
  const clientId = randomUUID();
  const send = (op: string, epoch = report.controlEpoch!, assistanceId = report.assistanceId) => f.app.request(path, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, op, epoch, assistanceId, operationId: randomUUID() }) });
  return { ...f, report, send, clientId };
}

it('queues early, concurrent and retried completion requests exactly once even with an active old run', async () => {
  const f = await assistanceFixture();
  try {
    const responses = await Promise.all([f.send('handback'), f.send('handback')]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(phoneAssistance(f.conversationId)?.status).toBe('queued');
    const queued = phoneAssistance(f.conversationId)?.queuedInputId;
    expect((await f.send('handback')).status).toBe(200);
    expect(phoneAssistance(f.conversationId)?.queuedInputId).toBe(queued);
    expect(getSessionInputState(f.conversationId).inputs).toHaveLength(1);
    expect(f.driver.execute).not.toHaveBeenCalled();
  } finally { await f.runtime.shutdown(); }
});

it('projects a saved wait after runtime restart and restores only when the user takes over', async () => {
  const f = await assistanceFixture();
  try {
    await f.runtime.shutdown();
    const connections = await f.app.request('/api/phone/connections');
    expect(await connections.json()).toMatchObject({ payload: [{ assistanceId: f.report.assistanceId, status: 'needs_user' }] });
    expect(f.runtime.status(f.conversationId)).toBeUndefined();
    const state = await f.app.request(`/api/phone/conversations/${f.conversationId}?clientId=${f.clientId}`);
    expect(await state.json()).toMatchObject({ payload: { ownControl: false, report: { assistanceId: f.report.assistanceId } } });
    const takeover = await f.send('takeover', 1);
    expect(takeover.status).toBe(200);
    const restored = (await takeover.json()).payload.report;
    expect(restored).toMatchObject({ controlOwner: 'human', assistanceId: f.report.assistanceId });
    expect(restored.sessionId).not.toBe(f.report.sessionId);
    // A stale URL from before restart can safely complete this same durable request.
    expect((await f.send('handback', restored.controlEpoch)).status).toBe(200);
    expect(phoneAssistance(f.conversationId)?.status).toBe('queued');
  } finally { await f.runtime.shutdown(); }
});

it('retains the wait when fresh observation fails and rejects another request identity', async () => {
  const f = await assistanceFixture();
  try {
    expect((await f.send('handback', f.report.controlEpoch!, randomUUID())).status).toBe(409);
    f.driver.observe.mockRejectedValueOnce(new Error('Phone temporarily unavailable'));
    expect((await f.send('handback')).status).toBe(500);
    expect(phoneAssistance(f.conversationId)?.status).toBe('open');
    expect(getSessionInputState(f.conversationId).inputs).toHaveLength(0);
    expect((await f.send('handback', f.runtime.status(f.conversationId)!.controlEpoch!)).status).toBe(200);
  } finally { await f.runtime.shutdown(); }
});

it('allows retry after handback succeeded but durable queue insertion failed', async () => {
  const f = await assistanceFixture();
  try {
    getSqliteDatabase().exec("CREATE TEMP TRIGGER fail_phone_queue BEFORE INSERT ON session_inputs BEGIN SELECT RAISE(ABORT, 'queue unavailable'); END");
    expect((await f.send('handback')).status).toBe(500);
    expect(phoneAssistance(f.conversationId)?.status).toBe('open');
    expect(f.runtime.status(f.conversationId)).toMatchObject({ controlOwner: 'agent', status: 'ready' });
    getSqliteDatabase().exec('DROP TRIGGER fail_phone_queue');
    expect((await f.send('handback')).status).toBe(200);
    expect(phoneAssistance(f.conversationId)?.status).toBe('queued');
    expect(getSessionInputState(f.conversationId).inputs).toHaveLength(1);
  } finally { await f.runtime.shutdown(); }
});
it('shares a model-free read-only device connection and validates its video ticket', async () => {
  const { app, runtime, phoneStreams } = fixture();
  const device = runtime.repository.save({ serial: 'emulator-5554', name: 'Shared phone', enabled: true, allowedApps: ['com.android.settings'] });
  try {
    const response = await app.request(`/api/phone/devices/${device.id}/view`, { method: 'POST' });
    expect(response.status).toBe(200);
    const [report] = runtime.reports();
    const address = `/api/phone/conversations/${encodeURIComponent(`device:${device.id}`)}`;
    const clientId = randomUUID();
    const ticket = await app.request(`${address}/${report.sessionId}/video-ticket`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId }) });
    expect(ticket.status).toBe(200);
    const issued = (phoneStreams.issue.mock.calls[0] as unknown as [{ client: string; validate: () => Promise<void> }])[0];
    expect(issued.client).toBe(`test:${clientId}:viewer`);
    await expect(issued.validate()).resolves.toBeUndefined();
    const live = await app.request(`${address}?clientId=${clientId}`);
    expect(await live.json()).toMatchObject({ payload: { ownControl: false, report: { mode: 'observe', controlOwner: 'none' } } });
  } finally { await runtime.shutdown(); }
});
it('issues the same origin-bound video ticket for a registered cloud phone', async () => {
  const { app, runtime, conversationId, phoneStreams } = fixture();
  const device = runtime.repository.save({ serial: 'cloud.example:10001', name: 'Cloud', enabled: true,
    allowedApps: ['com.android.settings'], connection: { kind: 'aliyun-adb', endpoint: 'cloud.example:10001', credentialId: randomUUID() } });
  const id = randomUUID();
  vi.spyOn(runtime, 'status').mockReturnValue({ sessionId: id, deviceId: device.id, agentId: 'main' } as ReturnType<typeof runtime.status>);
  const response = await app.request(`http://localhost/api/phone/conversations/${conversationId}/${id}/video-ticket`, {
    method: 'POST', body: JSON.stringify({ clientId: randomUUID() }), headers: { 'Content-Type': 'application/json' },
  });
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ payload: { transport: 'scrcpy-h264', ticket: 'one-use-ticket' } });
  expect(phoneStreams.issue).toHaveBeenCalledWith(expect.objectContaining({ origin: 'http://localhost', principal: 'test' }));
  await runtime.shutdown();
});
it('registers local phones, persists default selection and validates settings', async () => {
  const { app, runtime } = fixture();
  const models = await app.request('/api/phone/models');
  expect(models.status).toBe(200);
  const availableModels = (await models.json()).payload.models;
  expect(availableModels).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: MOCK_PHONE_MODEL })]));
  expect(availableModels).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'openai/gpt-6.1-sol', profile: 'structured-tools-phone-v1' })]));
  const added = await app.request('/api/phone/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serial: 'emulator-5554', name: 'Emulator', allowedApps: ['com.android.settings'] }) });
  expect(added.status).toBe(201);
  const body = await added.json(); expect(runtime.repository.defaultDevice()).toBe(body.payload.id);
  const response = await app.request('/api/phone/devices');
  expect(await response.json()).toMatchObject({ ok: true, payload: { devices: [{ name: 'Emulator' }], discovery: [{ emulator: true }] } });
  const invalid = await app.request(`/api/phone/devices/${body.payload.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowedApps: [] }) });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({ ok: false, error: { code: 'PHONE_APPS_REQUIRED' } });
});
it('does not let a paired device use the owner phone management surface', async () => {
  const { app, driver } = fixture(false);
  const response = await app.request('/api/phone/devices');
  expect(response.status).toBe(403); expect(driver.discover).not.toHaveBeenCalled();
  for (const [path, method] of [['/api/phone/wireless/discovery', 'GET'], ['/api/phone/wireless/pairings', 'POST'], ['/api/phone/wireless/pairings/id', 'DELETE'], ['/api/phone/wireless/connect', 'POST'], ['/api/phone/devices/id/reconnect', 'POST']])
    expect((await app.request(path, { method })).status).toBe(403);
});
it('checks session ownership and never exposes unregistered phone screens', async () => {
  const { app } = fixture();
  expect((await app.request('/api/phone/sessions/unknown')).status).toBe(404);
  expect((await app.request('/api/phone/devices/unknown/screen')).status).toBe(404);
});

it('binds live screens and control to an existing conversation and exact phone session', async () => {
  initializeTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: 'chat/model' }, phoneUse: { primary: MOCK_PHONE_MODEL } } }) });
  const { app, runtime, driver, conversationId, config } = fixture();
  const device = runtime.repository.save({ serial: 'emulator-5554', name: 'Test', enabled: true, allowedApps: ['com.android.settings'] });
  const clientId = randomUUID();
  vi.mocked(driver.observe).mockImplementation(async () => ({ frameId: randomUUID(), capturedAt: Date.now(), width: 100, height: 200, rotation: 0, package: 'com.android.settings', frame: Buffer.from('png-pixels'), elements: [] }));
  await runtime.execute(conversationId, { op: 'open', mode: 'control', deviceId: device.id }, { config, agentId: 'main', modelRef: MOCK_PHONE_MODEL });
  const id = runtime.status(conversationId)!.sessionId;
  const base = `/api/phone/conversations/${conversationId}`;
  expect((await app.request(`${base}?clientId=${clientId}`)).status).toBe(200);
  expect((await app.request(`/api/phone/conversations/${randomUUID()}/${id}/frame`)).status).toBe(404);
  expect((await app.request(`${base}/${randomUUID()}/frame`)).status).toBe(404);
  const screen = await app.request(`${base}/${id}/frame`);
  expect(screen.headers.get('Cache-Control')).toBe('no-store');
  expect(screen.headers.get('X-Phone-Frame-Seq')).toBe('1');
  const response = await app.request(`${base}/${id}/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, op: 'takeover', operationId: randomUUID(), epoch: 1 }) });
  expect(await response.json()).toMatchObject({ ok: true, payload: { ownControl: true, report: { controlOwner: 'human' } } });
  const handback = await app.request(`${base}/${id}/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, op: 'handback', operationId: randomUUID(), epoch: 2 }) });
  expect(handback.status).toBe(200);
  expect(await handback.json()).toMatchObject({ payload: { resumeTurnRequired: false, report: { controlOwner: 'none' } } });
  await runtime.shutdown();
});
it('denies live view and takeover for paired principals even when they know the session IDs', async () => {
  const { app, conversationId } = fixture(false);
  expect((await app.request(`/api/phone/conversations/${conversationId}?clientId=${randomUUID()}`)).status).toBe(403);
  expect((await app.request(`/api/phone/conversations/${conversationId}/${randomUUID()}/frame`)).status).toBe(403);
  expect((await app.request(`/api/phone/conversations/${conversationId}/${randomUUID()}/control`, { method: 'POST' })).status).toBe(403);
});

it('protects cloud credentials routes and rejects uploaded keys on ordinary device routes', async () => {
  const denied = fixture(false);
  expect((await denied.app.request('/api/phone/cloud/aliyun/test', { method: 'POST', body: '{}' })).status).toBe(403);
  const { app, runtime } = fixture();
  const test = vi.spyOn(runtime.cloud, 'test').mockResolvedValue({ token: randomUUID(), expiresAt: Date.now() + 10000, model: 'Cloud', androidVersion: '12', screenshot: 'data:image/jpeg;base64,', endpoint: 'cloud.example:10001', media: 'snapshot' });
  const response = await app.request('/api/phone/cloud/aliyun/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'cloud.example:10001', privateKey: 'private-fixture' }) });
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(await response.text()).not.toContain('private-fixture');
  expect(test).toHaveBeenCalledWith('test', 'cloud.example:10001', 'private-fixture', expect.any(AbortSignal));
  const forged = await app.request('/api/phone/devices', { method: 'POST', body: JSON.stringify({ serial: 'cloud:5555', name: 'Cloud', allowedApps: ['com.android.settings'], connection: { kind: 'aliyun-adb', endpoint: 'cloud:5555', credentialId: randomUUID() } }) });
  expect(forged.status).toBe(400);
  const oversized = await app.request('/api/phone/cloud/aliyun/test', { method: 'POST', body: 'x'.repeat(25000) }); expect(oversized.status).toBe(413);
  await runtime.shutdown();
});

it('defaults a new phone to all apps and persists explicit selected-only policies', async () => {
  const { app, runtime } = fixture();
  const added = await app.request('/api/phone/devices', { method: 'POST', body: JSON.stringify({ serial: 'emulator-5554', name: 'All apps' }), headers: { 'Content-Type': 'application/json' } });
  expect(added.status).toBe(201);
  const { payload } = await added.json(); expect(payload).toMatchObject({ appAccess: 'all', allowedApps: [] });
  const patch = (body: unknown) => app.request(`/api/phone/devices/${payload.id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  expect(await (await patch({ appAccess: 'selected', allowedApps: ['com.android.settings'] })).json()).toMatchObject({ payload: { appAccess: 'selected', allowedApps: ['com.android.settings'] } });
  expect((await patch({ appAccess: 'selected', allowedApps: [] })).status).toBe(400);
  expect(runtime.repository.get(payload.id).appAccess).toBe('selected');
  expect(await (await patch({ appAccess: 'all', allowedApps: [] })).json()).toMatchObject({ payload: { appAccess: 'all', allowedApps: [] } });
});
it('lists applications for registered cloud phones and discovered local phones through owner-only APIs', async () => {
  const { app, runtime, driver } = fixture();
  const cloud = runtime.repository.save({ serial: 'cloud.example:10001', name: 'Cloud', enabled: true, allowedApps: [], connection: { kind: 'aliyun-adb', endpoint: 'cloud.example:10001', credentialId: randomUUID() } });
  vi.spyOn(runtime, 'driverFor').mockResolvedValue(driver);
  const cloudApps = await app.request(`/api/phone/devices/${cloud.id}/apps`);
  expect(cloudApps.status).toBe(200); expect(cloudApps.headers.get('Cache-Control')).toBe('no-store');
  expect(await cloudApps.json()).toMatchObject({ payload: { applications: [{ label: '设置' }, { label: '时钟' }] } });
  expect((await app.request('/api/phone/apps?serial=emulator-5554')).status).toBe(200);
  expect((await app.request('/api/phone/apps?serial=unknown')).status).toBe(400);
  expect((await fixture(false).app.request(`/api/phone/devices/${cloud.id}/apps`)).status).toBe(403);
  expect((await fixture(false).app.request('/api/phone/apps?serial=emulator-5554')).status).toBe(403);
});

it('checks text input through the selected phone provider without changing phone configuration', async () => {
 const {app,runtime,driver}=fixture();
 const device=runtime.repository.save({serial:'cloud.example:10001',name:'Cloud',enabled:true,allowedApps:[],textInput:'manual',connection:{kind:'aliyun-adb',endpoint:'cloud.example:10001',credentialId:randomUUID()}});
 vi.spyOn(runtime.cloud,'driver').mockResolvedValue(driver as never);
 const response=await app.request(`/api/phone/devices/${device.id}/input-status`);
 expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
 expect(await response.json()).toMatchObject({payload:{unicode:'available',keyboardRequired:false,policy:'manual'}});
 expect(driver.textInputStatus).toHaveBeenCalledWith(device.serial,expect.any(AbortSignal));
 expect(runtime.repository.get(device.id)).toEqual(device);
});
it('refuses non-admin input diagnostics and diagnostics for a disabled phone', async () => {
 const guest=fixture(false); expect((await guest.app.request('/api/phone/devices/anything/input-status')).status).toBe(403);
 const {app,runtime,driver}=fixture(); const device=runtime.repository.save({serial:'emulator-5554',name:'Disabled',enabled:false,allowedApps:[]});
 expect((await app.request(`/api/phone/devices/${device.id}/input-status`)).status).toBe(403);
 expect(driver.textInputStatus).not.toHaveBeenCalled();
});

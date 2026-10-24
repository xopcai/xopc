import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PhoneSetupView } from '@xopcai/gateway-contract';

import { openXopcDatabase, closeXopcDatabase } from '../../../storage/sqlite/connection.js';
import type { PhoneRuntime } from '../../runtime.js';
import type { PhoneReport } from '../../contracts.js';
import { PhoneSetupService, type PhoneSetupDeps } from '../service.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'phone-setup-')); openXopcDatabase({ path: join(root, 'test.db') }); });
afterEach(async () => { closeXopcDatabase(); await rm(root, { recursive: true, force: true }); });
function fixture() {
  const context = { conversationId: randomUUID(), agentId: 'main' };
  const ready: PhoneSetupView['readiness'] = { enabled: true, toolAllowed: true,
    model: { ref: 'real/phone', chatRef: 'cloud/chat', supported: true, configured: true }, dependencies: [{ kind: 'adb', state: 'ready', canInstall: true }],
    devices: [{ id: 'device-one', name: 'Test phone', source: 'local', enabled: true, settingsAllowed: true }], localDiscovery: [] };
  let revision = '1'; let report: PhoneReport | undefined; let lease = false;
  const runtime = { status: vi.fn(() => report), stop: vi.fn(async () => { if (report) report = { ...report, status: 'closed', controlOwner: 'none' }; return report ?? { status: 'closed' }; }) } as unknown as PhoneRuntime;
  const deps: PhoneSetupDeps = { runtime, inspect: async () => ready, revision: () => revision, connected: vi.fn(async () => true), leaseActive: () => lease };
  const service = new PhoneSetupService(deps);
  const begin = async () => { const start = await service.command('start', {}, context) as PhoneSetupView; return service.begin(context, start.id, 'device-one', start.revision); };
  const putReport = (owner: string, patch: Partial<PhoneReport> = {}) => { report = { owner, sessionId: 'test-session', deviceId: 'device-one', deviceName: 'Test phone', agentId: 'main', modelRef: 'real/phone', mock: false, mode: 'control', status: 'ready', actions: 0, modelRequests: 0, verified: false, verificationLevel: 'none', steps: [], createdAt: Date.now(), updatedAt: Date.now(), controlOwner: 'agent', facts: ['Settings'], ...patch }; };
  return { context, ready, runtime, deps, service, begin, putReport, change: () => { revision = '2'; }, loseRuntime: () => { report = undefined; }, lease: (value: boolean) => { lease = value; } };
}
it('keeps inspection dry, reuses the same conversation plan, and pins explicit source selection', async () => {
  const f = fixture();
  expect(await f.service.command('start', {}, f.context, true)).toMatchObject({ dryRun: true, setup: null });
  const one = await f.service.command('start', {}, f.context) as PhoneSetupView;
  expect((await f.service.command('start', {}, f.context) as PhoneSetupView).id).toBe(one.id);
  expect(await f.service.source(f.context, one.id, 'aliyun', one.revision)).toMatchObject({ source: 'aliyun' });
  await expect(f.service.command('get', { setupId: one.id }, { ...f.context, conversationId: 'another' })).rejects.toThrow('NOT_FOUND');
  expect(f.ready.model.chatRef).toBe('cloud/chat');
});
it('requires real model, tool permission, allowed Settings and an online phone', async () => {
  const f = fixture(); const one = await f.service.command('start', {}, f.context) as PhoneSetupView;
  f.ready.toolAllowed = false; await expect(f.service.begin(f.context, one.id, 'device-one', one.revision)).rejects.toThrow('PERMISSION_REQUIRED');
  f.ready.toolAllowed = true; f.ready.model.supported = false;
  await expect(f.service.begin(f.context, one.id, 'device-one', one.revision)).rejects.toThrow('MODEL_REQUIRED');
  f.ready.model.supported = true; f.ready.devices[0].settingsAllowed = false;
  await expect(f.service.begin(f.context, one.id, 'device-one', one.revision)).rejects.toThrow('DEVICE_REQUIRED');
  f.ready.devices[0].settingsAllowed = true; f.deps.connected = async () => false;
  await expect(f.service.begin(f.context, one.id, 'device-one', one.revision)).rejects.toThrow('DEVICE_OFFLINE');
});
it('does not require local ADB for cloud, and rejects races or source substitution', async () => {
  const f = fixture(); f.ready.dependencies = []; f.ready.devices[0].source = 'aliyun';
  const started = await f.begin(); expect(started.state).toBe('verifying');
  expect(() => f.service.beforeInput(f.context, { op: 'open', deviceId: 'another', mode: 'control', appPackage: 'com.android.settings' })).toThrow('ACTION_DENIED');
  const second = fixture(); second.deps.connected = async () => { second.change(); return true; };
  await expect(second.begin()).rejects.toThrow('CONFLICT');
});
it('needs real host verification and a matching confirmed close, not supplied passed flags', async () => {
  const f = fixture(); const started = await f.begin(); const a = started.attempt!;
  const call = f.service.beforeInput(f.context, { op: 'open', deviceId: a.deviceId, mode: 'control', appPackage: 'com.android.settings' })!;
  f.putReport(call.owner); f.service.afterInput(f.context, call.owner, 'open');
  const forged = await f.service.command('verification_report', { setupId: started.id, passed: true }, f.context) as PhoneSetupView;
  expect(forged.checks.verified).toBe(false);
  expect(() => f.service.beforeInput(f.context, { op: 'run', goal: 'Buy something', maxActions: 6 })).toThrow('ACTION_DENIED');
  f.service.beforeInput(f.context, { op: 'run', goal: a.goal, completion: { requireChange: true, textAny: a.completion.textAny, appPackage: 'com.android.settings' }, maxActions: 6 });
  f.putReport(call.owner, { verified: true, verificationLevel: 'ui', actions: 1, modelRequests: 1 });
  f.service.afterInput(f.context, call.owner, 'run');
  expect((await f.service.command('get', { setupId: started.id }, f.context) as PhoneSetupView).state).toBe('verifying');
  await f.service.release(f.context, started.id);
  expect(await f.service.command('verification_report', { setupId: started.id }, f.context)).toMatchObject({ state: 'completed', stale: false,
    checks: { configured: true, read: true, operated: true, verified: true, released: true } });
  f.change(); expect((await f.service.command('get', { setupId: started.id }, f.context) as PhoneSetupView).stale).toBe(true);
});
it('does not count mock or a model finish as UI evidence and caps total test actions', async () => {
  const f = fixture(); const started = await f.begin(); const a = started.attempt!;
  const call = f.service.beforeInput(f.context, { op: 'open', deviceId: a.deviceId, mode: 'control', appPackage: 'com.android.settings' })!;
  f.putReport(call.owner, { mock: true, actions: 4, modelRequests: 1, verified: true, verificationLevel: 'ui' });
  f.service.afterInput(f.context, call.owner, 'open');
  const next = f.service.beforeInput(f.context, { op: 'run', goal: a.goal, completion: a.completion, maxActions: 6 })!;
  expect(next.input).toMatchObject({ maxActions: 2 });
  f.putReport(call.owner, { actions: 4, steps: [{ action: 'launch', at: Date.now(), dispatch: 'completed', actor: 'agent' }] });
  expect(f.service.beforeInput(f.context, { op: 'run', goal: a.goal, completion: a.completion, maxActions: 6 })?.input).toMatchObject({ maxActions: 3 });
  await f.service.release(f.context, started.id);
  expect(await f.service.command('verification_report', { setupId: started.id }, f.context)).toMatchObject({ state: 'needs_attention', checks: { verified: false, released: true } });
});
it('persists interruption without guessing release and keeps cancellation terminal', async () => {
  const f = fixture(); const started = await f.begin(); const a = started.attempt!;
  const call = f.service.beforeInput(f.context, { op: 'open', deviceId: a.deviceId, mode: 'control', appPackage: 'com.android.settings' })!;
  f.putReport(call.owner); f.service.afterInput(f.context, call.owner, 'open');
  f.loseRuntime(); f.lease(true);
  const restarted = new PhoneSetupService(f.deps);
  expect(await restarted.command('get', { setupId: started.id }, f.context)).toMatchObject({ state: 'needs_attention', attempt: { released: false } });
  await expect(restarted.release(f.context, started.id)).rejects.toThrow('LEASE_PENDING');
  f.lease(false); expect(await restarted.release(f.context, started.id)).toMatchObject({ checks: { released: true }, state: 'needs_attention' });
  await restarted.command('cancel', { setupId: started.id }, f.context);
  f.putReport(call.owner, { verified: true, actions: 2, modelRequests: 1, verificationLevel: 'ui' });
  restarted.afterInput(f.context, call.owner, 'run');
  expect((await restarted.command('get', { setupId: started.id }, f.context) as PhoneSetupView).state).toBe('cancelled');
});

it('collects actual runtime receipts through phone_use and releases its independent device lease', async () => {
  const { ConfigSchema } = await import('../../../config/schema.js');
  const { PhoneRuntime } = await import('../../runtime.js');
  const { PhoneRepository } = await import('../../repository.js');
  const { createPhoneUseTool } = await import('../../../agent/tools/phone-use-tool.js');
  const f = fixture(); const repository = new PhoneRepository();
  const device = repository.save({ serial: 'setup-emulator', name: 'Setup fixture', enabled: true, allowedApps: ['com.android.settings'] });
  f.ready.devices[0].id = device.id;
  let versionVisible = false;
  const runtime = new PhoneRuntime(repository, () => ({
    discover: async () => [{ serial: device.serial, name: device.name, state: 'device', emulator: true }],
    observe: async () => ({ frameId: randomUUID(), capturedAt: Date.now(), width: 1080, height: 2400, rotation: 0,
      package: 'com.android.settings', frame: Buffer.from('fixture-pixels'), elements: [{ text: versionVisible ? 'Android version 15' : 'About phone',
        description: '', resourceId: 'android:id/title', bounds: [0, 200, 500, 400] as [number, number, number, number], clickable: true, password: false, focused: false }] }),
    execute: async (_serial, action) => { if (action.type === 'tap') versionVisible = true; },
  }), async () => ({ predict: async () => ({ kind: 'action' as const, action: { type: 'tap' as const, point: [200, 200] as [number, number] } }) }));
  const service = new PhoneSetupService({ ...f.deps, runtime, leaseActive: () => repository.leaseActive(device.serial) });
  const start = await service.command('start', {}, f.context) as PhoneSetupView;
  const attempt = (await service.begin(f.context, start.id, device.id, start.revision)).attempt!;
  const tool = createPhoneUseTool({ runtime, getSetupService: () => service,
    context: () => ({ owner: f.context.conversationId, agentId: 'main', modelRef: 'real/phone', config: ConfigSchema.parse({ phone: { enabled: true } }) }) });
  try {
    const signal = new AbortController().signal;
    await tool.execute('open', { op: 'open', deviceId: device.id, mode: 'control', appPackage: 'com.android.settings' }, signal);
    await tool.execute('run', { op: 'run', goal: attempt.goal, completion: attempt.completion, maxActions: attempt.maxActions }, signal);
    await tool.execute('close', { op: 'close' }, signal);
    expect(await service.command('verification_report', { setupId: start.id }, f.context)).toMatchObject({ state: 'completed', checks: { verified: true, released: true } });
    expect(repository.leaseActive(device.serial)).toBe(false);
    expect(runtime.status(f.context.conversationId)).toBeUndefined();
    expect(JSON.stringify(service.current(f.context))).not.toContain('fixture-pixels');
  } finally { await runtime.shutdown(); }
});

it('preserves a model-quota blocker after confirmed release instead of blaming the device', async () => {
  const f = fixture(); const start = await f.begin();
  const call = f.service.beforeInput(f.context, { op: 'open', deviceId: start.attempt!.deviceId, mode: 'control', appPackage: 'com.android.settings' })!;
  f.putReport(call.owner, { errorCode: 'PHONE_MODEL_QUOTA_EXHAUSTED' });
  const report = await f.service.release(f.context, start.id);
  expect(report).toMatchObject({ state: 'needs_attention', checks: { released: true, verified: false }, error: expect.stringContaining('PHONE_MODEL_QUOTA_EXHAUSTED') });
});

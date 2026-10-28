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

it('automates configuration, dependency repair, registration and verification through the conversation commands', async () => {
  const f = fixture(); const context = { ...f.context, canConfigure: true };
  f.deps.configure = vi.fn(async enabled => { f.ready.enabled = enabled; });
  f.deps.install = vi.fn(async () => { f.ready.dependencies[0].state = 'ready'; });
  f.deps.registerLocal = vi.fn(async () => {});
  f.deps.models = () => [{ ref: 'real/phone', name: 'Phone model', configured: true }];
  let setup = await f.service.command('start', {}, context) as PhoneSetupView;
  expect(f.service.current(context)).not.toHaveProperty('canConfigure');
  setup = await f.service.command('source', { setupId: setup.id, source: 'local', expectedRevision: setup.revision }, context) as PhoneSetupView;
  f.ready.enabled = false;
  setup = await f.service.command('configure', { setupId: setup.id, enabled: true, expectedRevision: setup.revision }, context) as PhoneSetupView;
  expect(f.deps.configure).toHaveBeenCalledWith(true, expect.objectContaining({ check: expect.any(Function), signal: expect.any(AbortSignal) }));
  setup = await f.service.command('install_dependency', { setupId: setup.id, kind: 'adb', expectedRevision: setup.revision }, context) as PhoneSetupView;
  expect(f.deps.install).not.toHaveBeenCalled();
  f.ready.dependencies[0].state = 'corrupted';
  setup = await f.service.command('install_dependency', { setupId: setup.id, kind: 'adb', repair: true, expectedRevision: setup.revision }, context) as PhoneSetupView;
  expect(f.deps.install).toHaveBeenCalledWith('adb', true, expect.any(Object));
  setup = await f.service.command('register_local', { setupId: setup.id, serial: 'discovered-serial', expectedRevision: setup.revision }, context) as PhoneSetupView;
  expect(f.deps.registerLocal).toHaveBeenCalledWith('discovered-serial', undefined, expect.any(Object));
  expect(await f.service.command('models', {}, context)).toMatchObject({ models: [{ ref: 'real/phone' }] });
  const attempt = await f.service.command('begin_verification', { setupId: setup.id, deviceId: 'device-one', expectedRevision: setup.revision }, context) as PhoneSetupView;
  expect(attempt.state).toBe('verifying');
  expect(await f.service.command('release', { setupId: setup.id }, context)).toMatchObject({ attempt: { released: true } });
});
it('does not grant configuration authority from model arguments, stale revisions or unsupported dependency requests', async () => {
  const f = fixture(); f.deps.configure = vi.fn(); f.deps.install = vi.fn();
  const setup = await f.service.command('start', {}, f.context) as PhoneSetupView;
  const args = { setupId: setup.id, enabled: true, expectedRevision: setup.revision, canConfigure: true };
  await expect(f.service.command('configure', args, f.context)).rejects.toThrow('INTERACTIVE_REQUIRED');
  await f.service.command('configure', args, { ...f.context, canConfigure: true }, true);
  expect(f.deps.configure).not.toHaveBeenCalled();
  await expect(f.service.command('configure', { ...args, expectedRevision: 999 }, { ...f.context, canConfigure: true })).rejects.toThrow('CONFLICT');
  await expect(f.service.command('install_dependency', { ...args, kind: 'arbitrary-url' }, { ...f.context, canConfigure: true })).rejects.toThrow('dependency');
  expect(f.deps.install).not.toHaveBeenCalled();
});

it('caps automatic verification retries within a host run without exposing the run grant', async () => {
  const f = fixture(); const context = { ...f.context, canConfigure: true, runId: 'host-run' };
  let setup = await f.service.command('start', {}, context) as PhoneSetupView;
  for (let i = 0; i < 2; i++) {
    setup = await f.service.command('begin_verification', { setupId: setup.id, expectedRevision: setup.revision, deviceId: 'device-one' }, context) as PhoneSetupView;
    expect(setup).not.toHaveProperty('verificationRunId');
    setup = await f.service.command('release', { setupId: setup.id }, context) as PhoneSetupView;
  }
  await expect(f.service.command('begin_verification', { setupId: setup.id, expectedRevision: setup.revision, deviceId: 'device-one' }, context)).rejects.toThrow('RETRY_LIMIT');
  expect((await f.service.command('begin_verification', { setupId: setup.id, expectedRevision: setup.revision, deviceId: 'device-one' }, { ...context, runId: 'fresh-user-turn' }) as PhoneSetupView).state).toBe('verifying');
});

it.each(['configure', 'set_model', 'install_dependency'] as const)('does not commit %s after cancellation during readiness inspection', async command => {
  const f = fixture(); const context = { ...f.context, canConfigure: true };
  let setup = await f.service.command('start', {}, context) as PhoneSetupView;
  setup = await f.service.command('source', { setupId: setup.id, expectedRevision: setup.revision, source: 'local' }, context) as PhoneSetupView;
  f.ready.enabled = false; f.ready.model.ref = undefined; f.ready.dependencies[0].state = 'absent';
  let resume!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const inspected = new Promise<void>(resolve => { entered = resolve; });
  f.deps.inspect = vi.fn().mockImplementationOnce(async () => { entered(); await gate; return f.ready; }).mockImplementation(async () => f.ready);
  f.deps.configure = vi.fn(); f.deps.setModel = vi.fn(); f.deps.install = vi.fn();
  const pending = f.service.command(command, { setupId: setup.id, expectedRevision: setup.revision, enabled: true, modelRef: 'real/new', kind: 'adb' }, context);
  const rejection = expect(pending).rejects.toThrow();
  await inspected;
  expect((await f.service.command('cancel', { setupId: setup.id }, context) as PhoneSetupView).state).toBe('cancelled');
  resume(); await rejection;
  expect(f.deps.configure).not.toHaveBeenCalled(); expect(f.deps.setModel).not.toHaveBeenCalled(); expect(f.deps.install).not.toHaveBeenCalled();
});

it('reserves the setup revision, rejects overlapping writes, and rechecks live authority', async () => {
  const f = fixture(); let authorized = true;
  const context = { ...f.context, canConfigure: true, isAuthorized: () => authorized };
  const setup = await f.service.command('start', {}, context) as PhoneSetupView;
  f.ready.enabled = false; f.deps.configure = vi.fn();
  let resume!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; }); const inspected = new Promise<void>(resolve => { entered = resolve; });
  f.deps.inspect = vi.fn().mockImplementationOnce(async () => { entered(); await gate; return f.ready; }).mockImplementation(async () => f.ready);
  const pending = f.service.command('configure', { setupId: setup.id, expectedRevision: setup.revision, enabled: true }, context);
  const rejection = expect(pending).rejects.toThrow('authority'); await inspected;
  const claimed = f.service.current(context)!;
  expect(claimed.revision).toBeGreaterThan(setup.revision);
  await expect(f.service.command('configure', { setupId: setup.id, expectedRevision: claimed.revision, enabled: true }, context)).rejects.toThrow('BUSY');
  authorized = false; resume(); await rejection; expect(f.deps.configure).not.toHaveBeenCalled();
});

it('cancellation waits for an already-started commit to settle and never revives the request', async () => {
  const f = fixture(); const context = { ...f.context, canConfigure: true };
  const setup = await f.service.command('start', {}, context) as PhoneSetupView;
  f.ready.enabled = false;
  let resume!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; }); const committed = new Promise<void>(resolve => { entered = resolve; });
  f.deps.configure = vi.fn(async () => { entered(); await gate; });
  const pending = f.service.command('configure', { setupId: setup.id, expectedRevision: setup.revision, enabled: true }, context);
  const rejection = expect(pending).rejects.toThrow(); await committed;
  let cancelled = false;
  const cancellation = f.service.command('cancel', { setupId: setup.id }, context).then(value => { cancelled = true; return value; });
  await Promise.resolve(); expect(cancelled).toBe(false);
  resume(); await rejection; expect(await cancellation).toMatchObject({ state: 'cancelled' });
});

it('cancels every setup owner for a conversation and confirms release before reset', async () => {
  const f = fixture(); const setup = await f.begin();
  const binding = f.service.beforeInput(f.context, { op: 'open', deviceId: 'device-one', mode: 'control', appPackage: 'com.android.settings' })!;
  f.putReport(binding.owner); f.service.afterInput(f.context, binding.owner, 'open');
  await f.service.cancelConversation(f.context.conversationId);
  expect(f.runtime.stop).toHaveBeenCalledWith(binding.owner, 'close');
  expect(await f.service.command('get', { setupId: setup.id }, f.context)).toMatchObject({ state: 'cancelled', checks: { released: true } });
  expect(() => f.service.beforeInput(f.context, { op: 'open', deviceId: 'device-one', mode: 'control', appPackage: 'com.android.settings' })).not.toThrow();
});

it('invalidates a real conversation transcript grant after reset without reviving old evidence', async () => {
  const { createConversation } = await import('../../../storage/sqlite/conversation-repository.js');
  const { resetSessionRecord } = await import('../../../storage/sqlite/session-repository.js');
  const f = fixture(); createConversation({ agentId: 'main' }, root, f.context.conversationId);
  const setup = await f.begin(); resetSessionRecord(f.context.conversationId, root);
  expect(await f.service.command('get', { setupId: setup.id }, f.context)).toMatchObject({ stale: true });
  await expect(f.service.source(f.context, setup.id, 'local', setup.revision)).rejects.toThrow('SCOPE_CHANGED');
  expect(() => f.service.beforeInput(f.context, { op: 'open', deviceId: 'device-one', mode: 'control', appPackage: 'com.android.settings' })).toThrow('STOPPED');
});

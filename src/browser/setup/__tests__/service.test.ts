import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserActionInput, BrowserControlResult, BrowserObservation } from '@xopcai/browser-control-contract';

import { ConfigSchema } from '../../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../storage/sqlite/connection.js';
import type { EndpointToolRuntime } from '../../../endpoint-tools/index.js';
import { BrowserSetupService, browserConfigRevision, type BrowserSetupDeps } from '../service.js';
import { readBrowserSetup, saveBrowserSetup } from '../repository.js';
import { createXopcUseTool } from '../../../agent/tools/xopc-use-tool.js';
import { createBrowserUseTool } from '../../../agent/tools/browser/tool/browser-use-tool.js';
import { BrowserRuntime } from '../../runtime/browser-runtime.js';
import type { BrowserDriver } from '../../drivers/browser-driver.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'xopc-browser-setup-')); openXopcDatabase({ path: join(dir, 'test.db') }); });
afterEach(() => { closeXopcDatabase(); rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  let config = ConfigSchema.parse({ browser: { enabled: false, driver: { kind: 'extension' } } });
  let online = true;
  let allowed = true;
  const endpoint = { endpointId: 'chrome-one', principalId: 'device-one', kind: 'browser', displayName: 'Chrome', appVersion: '1', tools: [{ descriptor: { name: 'browser.control' } }] };
  const deps: BrowserSetupDeps = {
    getConfig: () => config, saveConfig: vi.fn(async next => { config = next; return { saved: true }; }),
    endpoints: { registry: { list: () => online ? [endpoint] : [] } } as unknown as EndpointToolRuntime,
    canUseBrowser: () => allowed,
    prepare: vi.fn(async () => ({})), open: vi.fn(async () => ({})),
    doctor: vi.fn(async () => ({ installed: true, nativeHost: { installed: true } })),
    release: vi.fn(async () => ({ ok: true, receipt: { action: 'close', verified: true, durationMs: 0, risk: 'read' } })),
  };
  const service = new BrowserSetupService(deps);
  const context = { conversationId: 'conversation-one', agentId: 'main' };
  const start = async () => {
    const view = await service.command('start', {}, context) as { id: string };
    return service.owned(view.id, context.conversationId, context.agentId);
  };
  const ready = async () => {
    let setup = await start();
    setup = service.approve(setup, 'owner', setup.revision);
    return service.prepare(setup);
  };
  return { service, deps, context, start, ready, config: () => config, endpoint, offline: () => { online = false; }, deny: () => { allowed = false; } };
}

function observed(url: string, sessionId: string, names: string[], revision = 1): BrowserControlResult {
  const observation: BrowserObservation = { sessionId, tabId: 'demo-tab', documentId: 'demo-doc', revision, url, title: 'Test',
    nodes: names.map((name, i) => ({ ref: `ref-${i}`, role: name === 'Test click' ? 'button' : name === 'Test input' ? 'textbox' : 'text', name, states: [] })),
    changes: { added: [], changed: [], removed: [] } };
  return { ok: true, receipt: { action: 'observe', verified: true, risk: 'read', durationMs: 1, observation } };
}

describe('Browser setup', () => {
  it('reuses the active conversation run and cannot mutate without product-owner approval', async () => {
    const f = fixture();
    const a = await f.start(); const b = await f.start();
    expect(b.id).toBe(a.id);
    expect(() => f.service.owned(a.id, 'another-conversation', 'main')).toThrow('SETUP_NOT_FOUND');
    await expect(f.service.prepare(a)).rejects.toThrow('OWNER_APPROVAL_REQUIRED');
    expect(f.deps.prepare).not.toHaveBeenCalled();
    expect(f.config().browser.enabled).toBe(false);
    const dryRun = await f.service.command('start', {}, { conversationId: 'other', agentId: 'main' }, true);
    expect(dryRun).toMatchObject({ dryRun: true, setup: null });
  });

  it('writes through the service, checks current revisions, and preserves concurrent configuration', async () => {
    const f = fixture();
    const setup = await f.start();
    f.config().browser.observation.maxNodes += 1;
    expect(() => f.service.approve(setup, 'owner', setup.revision)).toThrow('CONFIG_CHANGED');
    expect(f.deps.saveConfig).not.toHaveBeenCalled();
    const replacement = await f.start();
    expect(replacement.id).not.toBe(setup.id);
    const ready = await f.ready();
    expect(f.deps.saveConfig).toHaveBeenCalledOnce();
    expect(f.config().browser.enabled).toBe(true);
    expect(ready.state).toBe('ready_for_verification');
    await f.service.prepare(ready);
    expect(f.deps.prepare).toHaveBeenCalledOnce();
    expect(() => saveBrowserSetup(ready, 1)).toThrow('SETUP_CONFLICT');
  });

  it('does not switch a shared driver while existing browser sessions are in use', async () => {
    const f = fixture();
    f.config().browser.enabled = true;
    f.config().browser.driver = { kind: 'playwright', headless: true };
    f.deps.canSwitchDriver = () => false;
    const started = await f.start();
    const approved = f.service.approve(started, 'owner', started.revision);
    expect(await f.service.prepare(approved)).toMatchObject({ state: 'needs_attention', error: expect.stringContaining('BROWSER_BUSY') });
    expect(f.deps.saveConfig).not.toHaveBeenCalled();
    expect(f.deps.prepare).not.toHaveBeenCalled();
  });

  it('requires explicit endpoint selection and Agent permission, pins the demo and rejects foreign actions', async () => {
    const f = fixture(); const ready = await f.ready();
    expect(() => f.service.begin(ready, 'wrong', 'http://localhost:18790', ready.revision)).toThrow('ENDPOINT_OFFLINE');
    f.deny();
    expect(() => f.service.begin(ready, 'chrome-one', 'http://localhost:18790', ready.revision)).toThrow('AGENT_BROWSER_DENIED');
    const other = fixture(); const r = await other.ready();
    const testing = other.service.begin(r, 'chrome-one', 'http://localhost:18790', r.revision);
    expect(() => other.service.beforeAction('conversation-one', 'main', { action: 'navigate', url: 'https://example.com' })).toThrow('VERIFICATION_ACTION_DENIED');
    const action = other.service.beforeAction('conversation-one', 'main', { action: 'navigate', url: testing.attempt!.fixtureUrl })!;
    expect(action.input.target).toEqual({ kind: 'endpoint', endpointId: 'chrome-one' });
    expect(other.service.allowsVerificationUrl(action.taskKey, testing.attempt!.fixtureUrl)).toBe(true);
    expect(other.service.allowsVerificationUrl(action.taskKey, 'http://localhost:18790/api/config')).toBe(false);
    expect(other.service.allowsVerificationUrl('unrelated-task', testing.attempt!.fixtureUrl)).toBe(false);
  });

  it('does not accept a supplied passed report, and cancellation cannot be revived by late receipts', async () => {
    const f = fixture(); const ready = await f.ready();
    const test = f.service.begin(ready, 'chrome-one', 'http://localhost:18790', ready.revision);
    const report = await f.service.command('verification_report', { setupId: test.id, passed: true }, f.context);
    expect(report).toMatchObject({ state: 'verifying', checks: { read: false, released: false } });
    const cancelled = f.service.cancel(test);
    f.service.afterAction(test.id, test.attempt!.id, { action: 'navigate', url: test.attempt!.fixtureUrl }, observed(test.attempt!.fixtureUrl, test.attempt!.sessionId!, [`Read check: ${test.attempt!.marker}`]));
    expect(readBrowserSetup(test.id)?.state).toBe('cancelled');
    expect(() => f.service.beforeAction('conversation-one', 'main', { action: 'observe' })).toThrow('VERIFICATION_STOPPED');
    await f.service.release(readBrowserSetup(cancelled.id)!);
    expect(readBrowserSetup(test.id)).toMatchObject({ state: 'cancelled', attempt: { released: true } });
  });

  it('records real browser_use results through normal runtime and requires verified release to complete', async () => {
    const f = fixture(); const ready = await f.ready();
    const testing = f.service.begin(ready, 'chrome-one', 'http://localhost:18790', ready.revision);
    let a = testing.attempt!;
    let revision = 0; let clicked = false; let filled = false; let releaseFails = true;
    const result = (sessionId: string, action: BrowserActionInput['action'] = 'observe') => { const value = observed(a.fixtureUrl, sessionId, [`Read check: ${a.marker}`, 'Test click', 'Test input', ...(clicked ? [`Click passed: ${a.marker}`] : []), ...(filled ? [`Input passed: ${a.sample}`] : [])], ++revision); if (value.ok) value.receipt.action = action; return value; };
    const driver: BrowserDriver = {
      kind: 'extension', connect: vi.fn(), disconnect: vi.fn(), createSession: vi.fn(),
      navigate: async id => result(id, 'navigate'), observe: async id => (result(id) as { ok: true; receipt: { observation: BrowserObservation } }).receipt.observation,
      perform: async (id, input) => { if (input.action === 'click') clicked = true; if (input.action === 'fill') filled = true; return result(id, input.action); }, tabs: vi.fn(),
      closeSession: vi.fn(async () => { if (releaseFails) throw new Error('release unconfirmed'); }),
    };
    const runtime = new BrowserRuntime({ getConfig: () => f.config().browser, createDriver: async () => driver,
      canRestoreSetupSession: (key, id) => f.service.canRestoreSession(key, id),
      isTrustedSetupUrl: (key, url) => f.service.allowsVerificationUrl(key, url) });
    const tool = createBrowserUseTool({ getRuntime: () => runtime, getTaskId: () => f.context.conversationId, getAgentId: () => 'main', getSetupService: () => f.service });
    const call = (input: BrowserActionInput) => tool.execute('test', input, undefined as never, undefined as never);
    await call({ action: 'navigate', url: a.fixtureUrl });
    expect(readBrowserSetup(testing.id)?.attempt?.read).toBe(true);
    await call({ action: 'click', revision: 1, ref: 'ref-1' });
    await call({ action: 'fill', revision: 2, ref: 'ref-2', value: a.sample });
    expect(readBrowserSetup(testing.id)?.attempt).toMatchObject({ read: true, clicked: true, filled: true, released: false });
    await call({ action: 'close' });
    expect(readBrowserSetup(testing.id)).toMatchObject({ state: 'needs_attention', attempt: { released: false } });
    releaseFails = false;
    await call({ action: 'close' });
    expect(readBrowserSetup(testing.id)).toMatchObject({ state: 'needs_attention', attempt: { released: true } });
    const checked = await f.service.recheck(readBrowserSetup(testing.id)!);
    const repeat = f.service.begin(checked, 'chrome-one', 'http://localhost:18790', checked.revision);
    expect(repeat.attempt!.id).not.toBe(a.id);
    a = repeat.attempt!; revision = 0; clicked = false; filled = false;
    await call({ action: 'navigate', url: a.fixtureUrl });
    await call({ action: 'click', revision: 1, ref: 'ref-1' });
    await call({ action: 'fill', revision: 2, ref: 'ref-2', value: a.sample });
    await call({ action: 'close' });
    expect(readBrowserSetup(testing.id)).toMatchObject({ state: 'completed', attempt: { read: true, clicked: true, filled: true, released: true } });
    expect(driver.closeSession).toHaveBeenLastCalledWith(a.sessionId, { kind: 'endpoint', endpointId: 'chrome-one' });
    await runtime.shutdown();
  });

  it('limits actions, survives service restart, and refuses completed evidence for changed configuration', async () => {
    const f = fixture(); const ready = await f.ready();
    const test = f.service.begin(ready, 'chrome-one', 'http://localhost:18790', ready.revision);
    const restarted = new BrowserSetupService(f.deps);
    expect(restarted.canRestoreSession(`browser-setup:${test.id}:${test.attempt!.id}`, test.attempt!.sessionId!)).toBe(true);
    const limited = saveBrowserSetup({ ...test, attempt: { ...test.attempt!, actions: 12 } }, test.revision);
    expect(() => restarted.beforeAction('conversation-one', 'main', { action: 'observe' })).toThrow('VERIFICATION_BUDGET_EXCEEDED');
    expect(restarted.beforeAction('conversation-one', 'main', { action: 'close' })).toBeDefined();
    f.config().browser.enabled = false;
    expect(restarted.view(limited).stale).toBe(true);
    expect(browserConfigRevision(f.config())).not.toBe(test.configRevision);
  });

  it('keeps expired previews read-only and does not replace an unreleased cancelled session', async () => {
    const f = fixture(); const ready = await f.ready();
    const test = f.service.begin(ready, 'chrome-one', 'http://localhost:18790', ready.revision);
    const expired = saveBrowserSetup({ ...test, attempt: { ...test.attempt!, expiresAt: Date.now() - 1 } }, test.revision);
    expect(f.service.view(expired)).toMatchObject({ state: 'needs_attention' });
    await f.service.command('start', {}, f.context, true);
    expect(readBrowserSetup(test.id)?.revision).toBe(expired.revision);
    f.service.cancel(expired);
    const resumed = await f.service.command('start', {}, f.context);
    expect(resumed).toMatchObject({ id: test.id, state: 'cancelled', attempt: { released: false } });
  });

  it('invalidates evidence when Agent policy changes even when the tool stays enabled', async () => {
    const f = fixture(); let version = 'one';
    f.deps.policyRevision = () => version;
    const ready = await f.ready(); const test = f.service.begin(ready, 'chrome-one', 'http://localhost:18790', ready.revision);
    version = 'two';
    expect(f.service.view(test).stale).toBe(true);
    expect(() => f.service.beforeAction('conversation-one', 'main', { action: 'observe' })).toThrow('CONFIG_CHANGED');
    expect(f.service.beforeAction('conversation-one', 'main', { action: 'close' })).toBeDefined();
  });

  it('exposes setup through xopc_use without granting install or returning credential values', async () => {
    const f = fixture();
    const tool = createXopcUseTool({ getBrowserSetupService: () => f.service, getCurrentAgentId: () => 'main', getCurrentConversationId: () => 'conversation-one' });
    const result = await tool.execute('start', { mode: 'browser_setup', command: 'start' }, undefined as never, undefined as never);
    expect(result.details).toMatchObject({ mode: 'browser_setup', result: { state: 'plan_ready', skillName: 'configure-xopc', guidanceRefs: [{ path: 'references/browser/chrome-extension.md' }] } });
    expect(f.deps.prepare).not.toHaveBeenCalled();
    const denied = createXopcUseTool({ getBrowserSetupService: () => f.service, getCurrentAgentId: () => 'main', getCurrentConversationId: () => 'conversation-one', authorizeCapability: () => false });
    expect((await denied.execute('deny', { mode: 'browser_setup', command: 'inspect' }, undefined as never, undefined as never)).details.result).toMatchObject({ ok: false });
  });
});

it('inspects broken installed files and denied permission without modifying an existing plan', async () => {
  const f = fixture(); const ready = await f.ready();
  f.deps.doctor = vi.fn(async () => ({ installed: false, needsRefresh: true, nativeHost: { installed: false } }));
  f.deny();
  expect(await f.service.inspect(f.context.conversationId, 'main')).toMatchObject({
    installation: { installed: false, needsRefresh: true, nativeHostInstalled: false },
    toolPermission: 'denied', setup: { id: ready.id, revision: ready.revision },
  });
  expect(f.deps.prepare).toHaveBeenCalledOnce();
});

it('restores partial verification with fresh observation and refuses replay of passed writes', async () => {
  const f = fixture(); const ready = await f.ready();
  const started = f.service.begin(ready, 'chrome-one', 'http://localhost:18790', ready.revision);
  const a = started.attempt!;
  const observe = (action: 'navigate' | 'observe' | 'click' | 'fill', names: string[], revision: number) => {
    const receipt = observed(a.fixtureUrl, a.sessionId!, names, revision);
    if (receipt.ok) receipt.receipt.action = action;
    f.service.afterAction(started.id, a.id, { action } as BrowserActionInput, receipt);
  };
  observe('navigate', [`Read check: ${a.marker}`, 'Test click', 'Test input'], 1);
  const restored = new BrowserSetupService(f.deps);
  expect((await restored.inspect(f.context.conversationId, 'main')).setup).toMatchObject({ attempt: { id: a.id, read: true } });
  expect(() => restored.beforeAction(f.context.conversationId, 'main', { action: 'navigate', url: a.fixtureUrl })).toThrow('VERIFICATION_ACTION_DENIED');
  expect(restored.beforeAction(f.context.conversationId, 'main', { action: 'observe', sessionId: a.sessionId })).toMatchObject({ attemptId: a.id });
  observe('observe', [`Read check: ${a.marker}`, 'Test click', 'Test input'], 2);
  expect(() => restored.beforeAction(f.context.conversationId, 'main', { action: 'click', ref: 'ref-1', revision: 1 })).toThrow('VERIFICATION_ACTION_DENIED');
  restored.beforeAction(f.context.conversationId, 'main', { action: 'click', ref: 'ref-1', revision: 2 });
  observe('click', [`Read check: ${a.marker}`, 'Test click', 'Test input', `Click passed: ${a.marker}`], 3);
  expect(() => restored.beforeAction(f.context.conversationId, 'main', { action: 'click', ref: 'ref-1', revision: 3 })).toThrow('VERIFICATION_ACTION_DENIED');
  restored.beforeAction(f.context.conversationId, 'main', { action: 'fill', ref: 'ref-2', revision: 3, value: a.sample });
  observe('fill', [`Read check: ${a.marker}`, 'Test click', 'Test input', `Input passed: ${a.sample}`], 4);
  expect(() => restored.beforeAction(f.context.conversationId, 'main', { action: 'fill', ref: 'ref-2', revision: 4, value: a.sample })).toThrow('VERIFICATION_ACTION_DENIED');
  f.deny(); await restored.release(readBrowserSetup(started.id)!);
  expect(readBrowserSetup(started.id)).toMatchObject({ state: 'needs_attention', attempt: { released: true } });
});

it('creates a fresh reviewed plan after a policy change and confirmed cleanup instead of looping on stale evidence', async () => {
  const f = fixture(); const ready = await f.ready();
  const testing = f.service.begin(ready, 'chrome-one', 'http://localhost:18790', ready.revision);
  f.deny();
  expect(f.service.view(testing).stale).toBe(true);
  expect((await f.service.command('start', {}, f.context) as { id: string }).id).toBe(testing.id);
  await f.service.release(testing);
  const replacement = await f.service.command('start', {}, f.context);
  expect(replacement).toMatchObject({ state: 'plan_ready', stale: false, toolPermission: 'denied' });
  expect((replacement as { id: string }).id).not.toBe(testing.id);
  expect(readBrowserSetup(testing.id)?.state).toBe('cancelled');
  expect((replacement as { approvedBy?: string }).approvedBy).toBeUndefined();
});

it('keeps Chrome revocation distinct from cleanup and requires new verification evidence', async () => {
  const f = fixture(); const ready = await f.ready();
  const testing = f.service.begin(ready, 'chrome-one', 'http://localhost:18790', ready.revision);
  f.service.afterAction(testing.id, testing.attempt!.id, { action: 'observe' }, {
    ok: false, error: { code: 'DRIVER_UNAVAILABLE', message: 'BROWSER_CONTROL_REVOKED: user stopped Chrome control' },
  });
  expect(readBrowserSetup(testing.id)).toMatchObject({ state: 'needs_attention', error: expect.stringContaining('BROWSER_CONTROL_REVOKED') });
  await f.service.release(readBrowserSetup(testing.id)!);
  expect(readBrowserSetup(testing.id)).toMatchObject({ state: 'needs_attention', error: expect.stringContaining('BROWSER_CONTROL_REVOKED'), attempt: { released: true } });
  const checked = await f.service.recheck(readBrowserSetup(testing.id)!);
  const fresh = f.service.begin(checked, 'chrome-one', 'http://localhost:18790', checked.revision);
  expect(fresh.attempt!.id).not.toBe(testing.attempt!.id);
  expect(f.service.view(fresh).checks).toMatchObject({ read: false, clicked: false, filled: false, released: false });
});

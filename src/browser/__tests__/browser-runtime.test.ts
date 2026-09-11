import { describe, expect, it, vi } from 'vitest';

import type { BrowserControlResult, BrowserObservation } from '@xopcai/browser-control-contract';

import type { Config } from '../../config/schema.js';
import type { BrowserDriver } from '../drivers/browser-driver.js';
import { decideBrowserApproval } from '../policy/approval-store.js';
import { BrowserRuntime } from '../runtime/browser-runtime.js';

function observation(url: string, revision = 1): BrowserObservation {
  return {
    sessionId: 'runtime-session', tabId: 'tab-1', revision, documentId: `doc-${revision}`,
    url, title: url, nodes: [], changes: { added: [], changed: [], removed: [] },
  };
}

function success(url: string): BrowserControlResult {
  return { ok: true, receipt: { action: 'navigate', risk: 'read', durationMs: 1, verified: true, observation: observation(url) } };
}

function setup(crossDomainNavigation: 'allow' | 'ask' | 'deny') {
  const navigate = vi.fn(async (_sessionId, input: { url: string }) => success(input.url));
  const driver: BrowserDriver = {
    kind: 'playwright', connect: vi.fn(), disconnect: vi.fn(), createSession: vi.fn(), closeSession: vi.fn(),
    navigate: navigate as BrowserDriver['navigate'], observe: vi.fn(async () => observation('about:blank')),
    perform: vi.fn(), tabs: vi.fn(),
  };
  const browser = {
    enabled: true, driver: { kind: 'playwright', headless: true },
    observation: { maxNodes: 180, maxCharacters: 12_000, visualFallback: true },
    limits: { actionTimeoutMs: 30_000, sessionTimeoutMs: 1_800_000, maxSequenceLength: 10 },
    security: {
      privateNetworks: 'deny', allowedPrivateHosts: [], crossDomainNavigation,
      uploads: 'ask', consequentialActions: 'ask',
    },
  } as Config['browser'];
  const runtime = new BrowserRuntime({ getConfig: () => browser, createDriver: async () => driver });
  return { runtime, navigate, browser };
}

describe('BrowserRuntime', () => {
  it('keeps one task-bound session and blocks foreign session ids', async () => {
    const { runtime } = setup('allow');
    expect((await runtime.execute('task-a', { action: 'observe' })).ok).toBe(true);
    expect(await runtime.execute('task-a', { action: 'observe', sessionId: 'foreign' }))
      .toMatchObject({ ok: false, error: { code: 'SESSION_NOT_FOUND' } });
  });

  it('returns typed failures when disabled or when the driver cannot start', async () => {
    const disabled = setup('allow');
    disabled.browser.enabled = false;
    expect(await disabled.runtime.execute('task-a', { action: 'observe' }))
      .toMatchObject({ ok: false, error: { code: 'DRIVER_UNAVAILABLE' } });

    const failed = new BrowserRuntime({
      getConfig: () => setup('allow').browser,
      createDriver: async () => { throw new Error('driver failed'); },
    });
    expect(await failed.execute('task-a', { action: 'observe' }))
      .toMatchObject({ ok: false, error: { code: 'DRIVER_UNAVAILABLE', message: 'driver failed' } });
  });

  it('injects the session-bound target and preserves an explicit target', async () => {
    const observe = vi.fn(async () => observation('https://example.com'));
    const driver: BrowserDriver = {
      kind: 'extension', connect: vi.fn(), disconnect: vi.fn(), createSession: vi.fn(), closeSession: vi.fn(),
      navigate: vi.fn(), observe: observe as BrowserDriver['observe'], perform: vi.fn(), tabs: vi.fn(),
    };
    const browser = setup('allow').browser;
    const boundTarget = { kind: 'attached_tab' as const, bindingId: 'binding-1' };
    const runtime = new BrowserRuntime({
      getConfig: () => browser,
      createDriver: async () => driver,
      resolveTarget: () => boundTarget,
    });

    await runtime.execute('task-a', { action: 'observe' });
    expect(observe).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ target: boundTarget }), undefined);

    const explicitTarget = { kind: 'automation_window' as const };
    await runtime.execute('task-a', { action: 'observe', target: explicitTarget });
    expect(observe).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ target: explicitTarget }), undefined);
  });

  it('does not add an undefined target when the task has no tab binding', async () => {
    const observe = vi.fn(async () => observation('https://example.com'));
    const driver: BrowserDriver = {
      kind: 'extension', connect: vi.fn(), disconnect: vi.fn(), createSession: vi.fn(), closeSession: vi.fn(),
      navigate: vi.fn(), observe: observe as BrowserDriver['observe'], perform: vi.fn(), tabs: vi.fn(),
    };
    const runtime = new BrowserRuntime({
      getConfig: () => setup('allow').browser,
      createDriver: async () => driver,
      resolveTarget: () => undefined,
    });

    await runtime.execute('task-without-binding', { action: 'observe' });

    const forwarded = observe.mock.calls[0]?.[1];
    expect(forwarded).toEqual({ action: 'observe' });
    expect(Object.hasOwn(forwarded ?? {}, 'target')).toBe(false);
  });

  it('enforces cross-domain deny before navigation', async () => {
    const { runtime, navigate } = setup('deny');
    await runtime.execute('task-a', { action: 'navigate', url: 'https://one.example' });
    expect(await runtime.execute('task-a', { action: 'navigate', url: 'https://two.example' }))
      .toMatchObject({ ok: false, error: { code: 'BLOCKED_URL' } });
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('binds one-time approval to the exact action arguments', async () => {
    const { runtime, navigate } = setup('ask');
    await runtime.execute('task-a', { action: 'navigate', url: 'https://one.example' });
    const pending = await runtime.execute('task-a', { action: 'navigate', url: 'https://two.example/path' });
    if (pending.ok || !pending.error.approval) throw new Error('Expected approval');
    decideBrowserApproval(pending.error.approval.id, 'approved');
    expect(await runtime.execute('task-a', {
      action: 'navigate', url: 'https://two.example/other', approvalId: pending.error.approval.id,
    })).toMatchObject({ ok: false, error: { code: 'APPROVAL_REQUIRED' } });
    expect((await runtime.execute('task-a', {
      action: 'navigate', url: 'https://two.example/path', approvalId: pending.error.approval.id,
    })).ok).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(2);
  });
});

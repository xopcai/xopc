import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let detached: (source: { tabId?: number }, reason: string) => void;
let values: Record<string, unknown>;
const attach = vi.fn();
beforeEach(() => {
  vi.resetModules(); values = {}; attach.mockReset(); attach.mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn(async () => values), set: vi.fn(async input => Object.assign(values, input)), remove: vi.fn(async key => { delete values[key]; }) } },
    tabs: { get: vi.fn(async () => ({ url: 'https://example.com' })) },
    debugger: { attach, detach: vi.fn(), sendCommand: vi.fn().mockResolvedValue({}), onDetach: { addListener: vi.fn(listener => { detached = listener; }) } },
  });
});
afterEach(() => vi.unstubAllGlobals());
it('persists a user stop across module restart and new tabs until explicit resumption', async () => {
  let cdp = await import('./cdp');
  await cdp.ensureAttached(1); expect(attach).toHaveBeenCalledOnce();
  detached({ tabId: 1 }, 'canceled_by_user');
  await expect(cdp.ensureAttached(1)).rejects.toThrow('BROWSER_CONTROL_REVOKED');
  await expect(cdp.ensureAttached(2)).rejects.toThrow('BROWSER_CONTROL_REVOKED');
  vi.resetModules(); cdp = await import('./cdp');
  expect(await cdp.isControlPaused()).toBe(true);
  await expect(cdp.ensureAttached(2)).rejects.toThrow('BROWSER_CONTROL_REVOKED');
  expect(attach).toHaveBeenCalledOnce();
  await cdp.resumeControl(); await cdp.ensureAttached(2);
  expect(attach).toHaveBeenCalledTimes(2);
});
it('does not treat a closed tab as a user permission refusal', async () => {
  const cdp = await import('./cdp'); await cdp.ensureAttached(1);
  detached({ tabId: 1 }, 'target_closed');
  expect(await cdp.isControlPaused()).toBe(false);
  await cdp.ensureAttached(2); expect(attach).toHaveBeenCalledTimes(2);
});

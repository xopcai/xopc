import { expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, session: {}, utilityProcess: {} }));

import { RemoteShellWindow } from '../shell/window.js';

it('waits for in-flight native cookie installation before confirming partition cleanup', async () => {
  let finish!: () => void;
  const cookie = new Promise<void>(resolve => { finish = resolve; });
  const clear = vi.fn(async () => {});
  const view = new RemoteShellWindow('/main', '/assets', {} as never, () => {}, {} as never) as any;
  view.partition = { cookies: { set: () => cookie }, webRequest: { onBeforeSendHeaders() {} }, closeAllConnections: async () => {}, clearStorageData: clear, clearCache: async () => {} };
  view.origin = 'http://127.0.0.1:1234'; view.worker = { stop: async () => {} };
  const pending = view.installCookie({ name: 'synthetic', value: 'synthetic', expiresAt: Date.now() + 900000 });
  const closing = view.close(); await Promise.resolve(); await Promise.resolve();
  expect(clear).not.toHaveBeenCalled(); finish(); await pending; await closing;
  expect(clear).toHaveBeenCalledOnce();
});
it('does not install an old renewal result after the connection has been closed and replaced', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    let finish!: (cookie: unknown) => void;
    const request = new Promise(resolve => { finish = resolve; });
    const oldWorker = { request: vi.fn(() => request), stop: async () => {} };
    const partition = () => ({ cookies: { set: vi.fn(async () => {}) }, webRequest: { onBeforeSendHeaders() {} }, closeAllConnections: async () => {}, clearStorageData: async () => {}, clearCache: async () => {} });
    const view = new RemoteShellWindow('/main', '/assets', { snapshot: () => ({ epoch: 7 }) } as never, () => {}, {} as never) as any;
    view.worker = oldWorker; view.partition = partition(); view.activeEpoch = 7; view.origin = 'http://127.0.0.1:1234';
    view.scheduleRenewal(Date.now() + 900000); await vi.advanceTimersByTimeAsync(600001);
    expect(oldWorker.request).toHaveBeenCalledOnce(); await view.close();
    const nextPartition = partition(); view.partition = nextPartition; view.worker = { request: vi.fn() };
    finish({ name: 'stale', value: 'stale', expiresAt: Date.now() + 900000, renewalId: 'stale' });
    await Promise.resolve(); await Promise.resolve();
    expect(nextPartition.cookies.set).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

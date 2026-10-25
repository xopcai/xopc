import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ listeners: new Map<string, (event: unknown, path: unknown) => void>(),
  api: null as { menu: { onNavigate: (callback: (path: string) => void) => () => void } } | null }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: (_name: string, api: typeof bridge.api) => { bridge.api = api; } },
  ipcRenderer: { on: (name: string, callback: (event: unknown, path: unknown) => void) => bridge.listeners.set(name, callback), send: vi.fn(), invoke: vi.fn(), removeListener: vi.fn() }, webUtils: {} }));

beforeEach(async () => {
  vi.resetModules(); bridge.listeners.clear();
  vi.stubGlobal('window', { location: { href: 'http://127.0.0.1:18790/' }, addEventListener: vi.fn() });
  await import('../../../electron/preload.js');
});
afterEach(() => vi.unstubAllGlobals());

it.each(['success-old', 'failure-old'])('retains %s activation until the reopened renderer can navigate', runId => {
  const route = `/automations?automation=task&run=${runId}`;
  bridge.listeners.get('menu:navigate')!(null, route);
  const navigate = vi.fn();
  const stop = bridge.api!.menu.onNavigate(navigate);
  expect(navigate).toHaveBeenCalledExactlyOnceWith(route);
  stop();
  const secondMount = vi.fn(); bridge.api!.menu.onNavigate(secondMount);
  expect(secondMount).not.toHaveBeenCalled();
});

it('queues a clicked execution when the renderer temporarily unmounts its navigation listener', () => {
  const first = vi.fn(); const stop = bridge.api!.menu.onNavigate(first);
  stop();
  bridge.listeners.get('menu:navigate')!(null, '/automations?automation=task&run=original');
  const remounted = vi.fn(); bridge.api!.menu.onNavigate(remounted);
  expect(first).not.toHaveBeenCalled();
  expect(remounted).toHaveBeenCalledExactlyOnceWith('/automations?automation=task&run=original');
});

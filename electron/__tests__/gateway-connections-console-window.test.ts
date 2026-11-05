import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const partition = {
    fetch: vi.fn(async () => Response.json({ conversationId: 'gateway:browser:session' })),
    setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn(), on: vi.fn(),
    closeAllConnections: vi.fn(), clearStorageData: vi.fn(), clearCache: vi.fn(),
  };
  const contents = { getURL: () => 'https://remote.example/#/chat', setWindowOpenHandler: vi.fn(), on: vi.fn() };
  const window = { webContents: contents, loadURL: vi.fn(), on: vi.fn(), once: vi.fn(), isDestroyed: () => false, destroy: vi.fn() };
  return { partition, window, create: vi.fn(), authenticate: vi.fn(async () => ({ gatewayId: 'gateway', publicKey: 'key' })), close: vi.fn() };
});
vi.mock('electron', () => ({
  BrowserWindow: class { constructor(options: unknown) { fixture.create(options); return fixture.window; } },
  session: { fromPartition: () => fixture.partition },
}));
vi.mock('../gateway/remote-upstream.js', () => ({ RemoteGatewayUpstream: class { authenticate = fixture.authenticate; close = fixture.close; } }));

import { RemoteConsoleWindow } from '../gateway/remote-console-window.js';

it('opens the full remote console in an authenticated isolated browser, without local IPC', async () => {
  const manager = {
    snapshot: () => ({ epoch: 7 }), beginConnection: async () => ({ epoch: 7 }),
    privateConnection: async () => ({ origin: 'https://remote.example', token: 'saved-token' }), pinIdentity: async () => ({ epoch: 7 }),
  };
  const view = new RemoteConsoleWindow(manager as never, () => {});
  await view.connect(7, 'profile');
  expect(fixture.window.loadURL).toHaveBeenCalledWith('https://remote.example/#/chat');
  const options = fixture.create.mock.calls[0][0];
  expect(options.webPreferences).toMatchObject({ session: fixture.partition, sandbox: true, nodeIntegration: false, contextIsolation: true });
  expect(options.webPreferences).not.toHaveProperty('preload');
  expect(view.captureWindow()).toBe(fixture.window);
  expect(fixture.close).toHaveBeenCalledOnce();
  await view.close();
  expect(fixture.partition.fetch).toHaveBeenLastCalledWith('https://remote.example/api/browser-session', expect.objectContaining({ method: 'DELETE', redirect: 'error' }));
  expect(fixture.partition.clearStorageData).toHaveBeenCalledOnce();
});

import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';

const shellState = vi.hoisted(() => ({ login: false, getPath: vi.fn(), setLogin: vi.fn(), rm: vi.fn(async () => {}) }));
vi.mock('electron', () => ({ app: {
  getPath: shellState.getPath, isPackaged: false,
  getLoginItemSettings: () => ({ openAtLogin: shellState.login }),
  setLoginItemSettings: (settings: { openAtLogin: boolean }) => { shellState.setLogin(settings); shellState.login = settings.openAtLogin; },
}, Notification: {}, powerSaveBlocker: {}, desktopCapturer: {}, shell: {}, systemPreferences: {} }));
vi.mock('node:fs/promises', () => ({ constants: {}, access: vi.fn(), readFile: vi.fn(async () => '{}'), writeFile: vi.fn(), rm: shellState.rm }));
vi.mock('../tray.js', () => ({ hasSystemTray: () => true }));
vi.mock('../auto-updater.js', () => ({ hasPendingInstall: () => false, stopAutoUpdater: vi.fn() }));
vi.mock('../gateway-process.js', () => ({ stopGatewayProcess: vi.fn() }));
vi.mock('../ipc/cron-display-wake-ipc.js', () => ({ stopCronDisplayWakeBlocker: vi.fn() }));
vi.mock('../tunnel-main.js', () => ({ stopTunnelStatusPolling: vi.fn() }));
vi.mock('../../src/config/paths.js', () => ({ resolveStateDir: () => '/test/xopc-state', resolveConfigPath: () => '/test/xopc-state/xopc.json' }));

import { initElectronShellPreferences, registerSystemSettingsIpc } from '../ipc/system-settings-ipc.js';
import { disableOpenAtLogin } from '../uninstall/prepare-shutdown.js';
import { removeUserDataDirs } from '../uninstall/remove-user-data-dirs.js';

const handlers = new Map<string, (event: IpcMainInvokeEvent, input?: unknown) => unknown>();
const event = { senderFrame: { url: 'http://127.0.0.1:18790/' }, sender: { getURL: () => 'http://127.0.0.1:18790/' } } as IpcMainInvokeEvent;
beforeAll(async () => {
  shellState.getPath.mockImplementation((name: string) => {
    if (!['userData', 'sessionData', 'logs'].includes(name)) throw new Error(`Unsupported Electron path: ${name}`);
    return `/test/${name}`;
  });
  await initElectronShellPreferences();
  registerSystemSettingsIpc({ handle: (name: string, handler: (event: IpcMainInvokeEvent, input?: unknown) => unknown) => handlers.set(name, handler) } as unknown as IpcMain);
});
beforeEach(() => { shellState.login = false; vi.clearAllMocks(); });

it('changes open-at-login using only the supported Electron API', async () => {
  const update = handlers.get('system-settings:set-behavior')!;
  const result = await update(event, { openAtLogin: true });
  expect(shellState.setLogin).toHaveBeenCalledExactlyOnceWith({ openAtLogin: true });
  expect(result).toMatchObject({ ok: true, behavior: { openAtLogin: true } });
  expect((result as { behavior: object }).behavior).not.toHaveProperty('openAsHidden');
  shellState.setLogin.mockClear();
  await update(event, { openAsHidden: true });
  expect(shellState.setLogin).not.toHaveBeenCalled();
});

it('disables login startup during uninstall without passing removed options', () => {
  shellState.login = true;
  disableOpenAtLogin();
  expect(shellState.setLogin).toHaveBeenCalledExactlyOnceWith({ openAtLogin: false });
  shellState.setLogin.mockClear();
  disableOpenAtLogin();
  expect(shellState.setLogin).not.toHaveBeenCalled();
});

it('cleans the owned session data path instead of calling the removed cache path name', async () => {
  await removeUserDataDirs();
  expect(shellState.getPath.mock.calls.map(([name]) => name)).toEqual(['userData', 'sessionData', 'logs']);
  expect(shellState.rm.mock.calls.map(([path]) => path)).toEqual([
    resolve('/test/userData'), resolve('/test/sessionData'), resolve('/test/logs'), resolve('/test/xopc-state'),
  ]);
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    handlers,
    nativeHandlers: new Map<string, (...args: unknown[]) => void>(),
    builtinCheckForUpdates: vi.fn(),
    bypassQuitConfirmation: vi.fn(),
    updater: {
      setFeedURL: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler)),
      checkForUpdates: vi.fn(() => Promise.resolve()),
      quitAndInstall: vi.fn(),
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowPrerelease: true,
      disableWebInstaller: false,
      logger: undefined,
    },
  };
});

vi.mock('electron', () => ({
  app: { isPackaged: true },
  autoUpdater: {
    checkForUpdates: mocks.builtinCheckForUpdates,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => mocks.nativeHandlers.set(event, handler)),
  },
}));
vi.mock('electron-updater', () => ({ default: { autoUpdater: mocks.updater } }));
vi.mock('@xopcai/xopc/utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../quit-confirmation.js', () => ({
  bypassNextAppQuitConfirmation: mocks.bypassQuitConfirmation,
}));

let updater: typeof import('../auto-updater.js');

describe('Electron auto updater', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    vi.useFakeTimers();
    mocks.handlers.clear();
    mocks.nativeHandlers.clear();
    mocks.builtinCheckForUpdates.mockClear();
    mocks.bypassQuitConfirmation.mockClear();
    mocks.updater.quitAndInstall.mockClear();
    mocks.updater.checkForUpdates.mockClear();
    updater = await import('../auto-updater.js');
    updater.initAutoUpdater({
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    } as never);
  });

  afterEach(() => {
    updater.stopAutoUpdater();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('installs a validated update without starting a competing native update check', () => {
    mocks.handlers.get('update-downloaded')?.({ version: '0.0.273' });

    mocks.nativeHandlers.get('update-downloaded')?.();
    updater.quitAndInstall();

    expect(mocks.builtinCheckForUpdates).not.toHaveBeenCalled();
    expect(mocks.bypassQuitConfirmation).toHaveBeenCalledOnce();
    expect(mocks.updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('waits for native macOS validation before allowing installation', () => {
    mocks.handlers.get('update-downloaded')?.({ version: '0.0.401' });

    expect(updater.getUpdateStatus()).toMatchObject({ state: 'downloading', percent: 100 });
    updater.quitAndInstall();
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
    expect(mocks.bypassQuitConfirmation).not.toHaveBeenCalled();

    mocks.nativeHandlers.get('update-downloaded')?.();
    expect(updater.getUpdateStatus()).toEqual({ state: 'downloaded', version: '0.0.401' });
  });

  it('shows signature failures, blocks install, and allows another update check', () => {
    mocks.handlers.get('update-downloaded')?.({ version: '0.0.401' });
    const error = new Error('Code signature did not pass validation');
    mocks.handlers.get('error')?.(error);
    mocks.handlers.get('error')?.(error);

    expect(updater.hasPendingInstall()).toBe(false);
    expect(updater.getUpdateStatus()).toEqual({ state: 'error', message: error.message });
    updater.quitAndInstall();
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
    expect(mocks.bypassQuitConfirmation).not.toHaveBeenCalled();

    // A delayed native event must not revive the rejected package.
    mocks.nativeHandlers.get('update-downloaded')?.();
    vi.advanceTimersByTime(31_000);
    expect(updater.getUpdateStatus()).toEqual({ state: 'error', message: error.message });
    updater.checkForUpdates(true);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalled();
  });

  it('keeps the direct install flow on Windows', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    mocks.handlers.get('update-downloaded')?.({ version: '0.0.401' });

    expect(updater.getUpdateStatus()).toEqual({ state: 'downloaded', version: '0.0.401' });
    updater.quitAndInstall();
    expect(mocks.updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });
});

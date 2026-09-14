import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    handlers,
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
  autoUpdater: { checkForUpdates: mocks.builtinCheckForUpdates },
}));
vi.mock('electron-updater', () => ({ default: { autoUpdater: mocks.updater } }));
vi.mock('@xopcai/xopc/utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../quit-confirmation.js', () => ({
  bypassNextAppQuitConfirmation: mocks.bypassQuitConfirmation,
}));

import { initAutoUpdater, quitAndInstall, stopAutoUpdater } from '../auto-updater.js';

describe('Electron auto updater', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.handlers.clear();
    mocks.builtinCheckForUpdates.mockClear();
    mocks.bypassQuitConfirmation.mockClear();
    mocks.updater.quitAndInstall.mockClear();
  });

  it('installs a downloaded update without starting a competing native update check', () => {
    initAutoUpdater({
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    } as never);
    mocks.handlers.get('update-downloaded')?.({ version: '0.0.273' });

    quitAndInstall();

    expect(mocks.builtinCheckForUpdates).not.toHaveBeenCalled();
    expect(mocks.bypassQuitConfirmation).toHaveBeenCalledOnce();
    expect(mocks.updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    stopAutoUpdater();
  });
});

import type { IpcMain } from 'electron';

import { getUpdateStatus, checkForUpdates, quitAndInstall } from '../auto-updater.js';

import { assertTrustedRenderer } from './trusted-renderer.js';

/**
 * Register updater-related IPC handlers.
 */
export function registerUpdaterIpc(ipcMain: IpcMain): void {
  ipcMain.handle('updater:get-status', (event) => {
    assertTrustedRenderer(event);
    return getUpdateStatus();
  });

  ipcMain.handle('updater:check', (event) => {
    assertTrustedRenderer(event);
    checkForUpdates(true);
    return { ok: true };
  });

  ipcMain.handle('updater:quit-and-install', (event) => {
    assertTrustedRenderer(event);
    quitAndInstall();
    return { ok: true };
  });
}

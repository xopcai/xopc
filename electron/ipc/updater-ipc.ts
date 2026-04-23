import type { IpcMain } from 'electron';

import { getUpdateStatus, checkForUpdates, quitAndInstall } from '../auto-updater.js';

/**
 * Register updater-related IPC handlers.
 */
export function registerUpdaterIpc(ipcMain: IpcMain): void {
  ipcMain.handle('updater:get-status', () => {
    return getUpdateStatus();
  });

  ipcMain.handle('updater:check', () => {
    checkForUpdates();
    return { ok: true };
  });

  ipcMain.handle('updater:quit-and-install', () => {
    quitAndInstall();
    return { ok: true };
  });
}

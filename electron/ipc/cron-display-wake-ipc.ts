import { type IpcMain, powerSaveBlocker } from 'electron';

import { assertTrustedRenderer } from './trusted-renderer.js';

let cronDisplayWakeBlockerId: number | null = null;

export function registerCronDisplayWakeIpc(ipcMain: IpcMain): void {
  ipcMain.handle('cron:set-prevent-display-sleep', (event, enabled: unknown) => {
    assertTrustedRenderer(event);
    const on = enabled === true;
    if (on) {
      if (cronDisplayWakeBlockerId == null) {
        cronDisplayWakeBlockerId = powerSaveBlocker.start('prevent-display-sleep');
      }
      return;
    }
    if (cronDisplayWakeBlockerId != null) {
      powerSaveBlocker.stop(cronDisplayWakeBlockerId);
      cronDisplayWakeBlockerId = null;
    }
  });
}

export function stopCronDisplayWakeBlocker(): void {
  if (cronDisplayWakeBlockerId != null) {
    powerSaveBlocker.stop(cronDisplayWakeBlockerId);
    cronDisplayWakeBlockerId = null;
  }
}

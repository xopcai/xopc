import { app } from 'electron';

import { hasPendingInstall, stopAutoUpdater } from '../auto-updater.js';
import { stopGatewayProcess } from '../gateway-process.js';
import { stopCronDisplayWakeBlocker } from '../ipc/cron-display-wake-ipc.js';
import { stopAllPowerSaveBlockers } from '../ipc/system-settings-ipc.js';
import { stopTunnelStatusPolling } from '../tunnel-main.js';

import { UninstallError } from './errors.js';

export function disableOpenAtLogin(): void {
  const cur = app.getLoginItemSettings();
  if (cur.openAtLogin) {
    app.setLoginItemSettings({
      openAtLogin: false,
      openAsHidden: cur.openAsHidden ?? false,
    });
  }
}

export function assertNoPendingUpdate(): void {
  if (hasPendingInstall()) {
    throw new UninstallError('PENDING_UPDATE');
  }
}

/** Stop gateway, tunnel, updater, and power blockers before data removal or uninstall. */
export function prepareShutdown(): void {
  assertNoPendingUpdate();
  stopGatewayProcess();
  stopTunnelStatusPolling();
  stopAutoUpdater();
  stopAllPowerSaveBlockers();
  stopCronDisplayWakeBlocker();
}

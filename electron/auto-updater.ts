import { app, type BrowserWindow } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';

import { createLogger } from '@xopcai/xopc/utils/logger.js';

const log = createLogger('AutoUpdater');

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string; releaseDate?: string }
  | { state: 'not-available' }
  | {
      state: 'downloading';
      percent: number;
      bytesPerSecond: number;
      transferred: number;
      total: number;
    }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

let currentStatus: UpdateStatus = { state: 'idle' };
let checkTimer: ReturnType<typeof setInterval> | null = null;
let mainWindowRef: BrowserWindow | null = null;

const CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 4 * 3600_000;

/**
 * Initialize the auto-updater. Must be called after app.whenReady() and only in packaged builds.
 */
export function initAutoUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) {
    log.info('Auto-updater disabled: app is not packaged');
    return;
  }

  mainWindowRef = mainWindow;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.logger = {
    info: (message: string) => log.info(message),
    warn: (message: string) => log.warn(message),
    error: (message: string) => log.error(message),
    debug: (message: string) => log.debug(message),
  } as typeof autoUpdater.logger;

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for updates...');
    setStatus({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    log.info({ version: info.version }, `Update available: v${info.version}`);
    setStatus({
      state: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', () => {
    log.info('Already up to date');
    setStatus({ state: 'not-available' });
    setTimeout(() => {
      if (currentStatus.state === 'not-available') {
        setStatus({ state: 'idle' });
      }
    }, 5000);
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    setStatus({
      state: 'downloading',
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    log.info({ version: info.version }, `Update downloaded: v${info.version}. Ready to install.`);
    setStatus({ state: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err: Error) => {
    log.error({ err }, `Auto-updater error: ${err.message}`);
    setStatus({ state: 'error', message: err.message });
    setTimeout(() => {
      if (currentStatus.state === 'error') {
        setStatus({ state: 'idle' });
      }
    }, 30_000);
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((err) => {
      log.warn({ err }, 'Initial update check failed');
    });
  }, CHECK_DELAY_MS);

  checkTimer = setInterval(() => {
    void autoUpdater.checkForUpdates().catch((err) => {
      log.warn({ err }, 'Periodic update check failed');
    });
  }, CHECK_INTERVAL_MS);

  log.info('Auto-updater initialized');
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus;
}

export function checkForUpdates(): void {
  void autoUpdater.checkForUpdates().catch((err) => {
    log.warn({ err }, 'Manual update check failed');
  });
}

export function quitAndInstall(): void {
  if (currentStatus.state !== 'downloaded') {
    log.warn({ state: currentStatus.state }, 'quitAndInstall called but no update is downloaded');
    return;
  }
  log.info('Quitting and installing update...');
  autoUpdater.quitAndInstall(false, true);
}

export function stopAutoUpdater(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
  mainWindowRef = null;
}

function setStatus(status: UpdateStatus): void {
  currentStatus = status;
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('updater:status-changed', status);
  }
}

import { app, autoUpdater as nativeAutoUpdater, type BrowserWindow } from 'electron';
import type { NsisUpdater } from 'electron-updater';
import electronUpdater from 'electron-updater';
import type { UpdateInfo, ProgressInfo } from 'electron-updater';

const { autoUpdater } = electronUpdater;

import { createLogger } from '@xopcai/xopc/utils/logger.js';

import { bypassNextAppQuitConfirmation } from './quit-confirmation.js';

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
let lastCheckWasManual = false;

/**
 * True after `update-downloaded` until process exit. Further `checkForUpdates` calls are skipped to avoid
 * racing Squirrel.Mac (proxy + native autoUpdater) and to prevent `update-not-available` from clearing UI state.
 */
let updateDownloadedPendingInstall = false;
let pendingMacVersion: string | null = null;

const CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 4 * 3600_000;

/** Baked into app-update.yml; overridden here so dev builds and env can point elsewhere. */
const DEFAULT_UPDATE_FEED_BASE = 'https://xopc.ai/api/download';

/**
 * Initialize the auto-updater. Must be called after app.whenReady() and only in packaged builds.
 */
export function initAutoUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) {
    log.info('Auto-updater disabled: app is not packaged');
    return;
  }

  mainWindowRef = mainWindow;

  const feedBaseRaw = (process.env['XOPC_UPDATE_FEED_URL'] ?? DEFAULT_UPDATE_FEED_BASE).replace(/\/$/, '');
  let effectiveFeedBase = feedBaseRaw;
  try {
    const feedUrl = new URL(feedBaseRaw);
    if (app.isPackaged && feedUrl.protocol !== 'https:') {
      log.warn(
        { feedBase: feedBaseRaw },
        'Update feed URL is not HTTPS; falling back to default for security',
      );
      effectiveFeedBase = DEFAULT_UPDATE_FEED_BASE.replace(/\/$/, '');
    }
  } catch {
    log.error({ feedBase: feedBaseRaw }, 'Invalid update feed URL; falling back to default');
    effectiveFeedBase = DEFAULT_UPDATE_FEED_BASE.replace(/\/$/, '');
  }

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: effectiveFeedBase,
  });
  log.info({ feedBase: effectiveFeedBase }, 'electron-updater generic feed');

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  // NSIS: avoid web-installer path; not used for our generic full .exe feed.
  autoUpdater.disableWebInstaller = true;
  // Windows: differential/blockmap against custom generic mirrors often fails verification
  // or never reaches `update-downloaded`; full installer download is more reliable.
  if (process.platform === 'win32') {
    autoUpdater.disableDifferentialDownload = true;
    // Release builds must keep signature verification enabled. This override is only for local
    // updater-feed migration tests where the publisherName metadata is known to be wrong.
    if (process.env['XOPC_WIN_UPDATER_SKIP_SIGNATURE_VERIFY'] === '1') {
      log.warn('Windows auto-update: skipping exe signature verification by explicit override.');
      (autoUpdater as NsisUpdater).verifyUpdateCodeSignature = async () => null;
    }
  }

  autoUpdater.logger = {
    info: (message: string) => log.info(message),
    warn: (message: string) => log.warn(message),
    error: (message: string) => log.error(message),
    debug: (message: string) => log.debug(message),
  } as typeof autoUpdater.logger;

  if (process.platform === 'darwin') {
    nativeAutoUpdater.on('update-downloaded', () => {
      if (!pendingMacVersion) return;
      log.info({ version: pendingMacVersion }, 'macOS update validated and ready to install');
      setStatus({ state: 'downloaded', version: pendingMacVersion });
      pendingMacVersion = null;
    });
  }

  autoUpdater.on('checking-for-update', () => {
    if (updateDownloadedPendingInstall) {
      return;
    }
    // A new metadata fetch can start while a previous check's download is still running
    // (electron-updater clears its internal check promise once the first check returns).
    // Do not clobber download UI or risk a transient fetch failure surfacing as `error`.
    if (currentStatus.state === 'downloading') {
      log.debug('Ignoring checking-for-update while download in progress');
      return;
    }
    log.info('Checking for updates...');
    setStatus({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    if (updateDownloadedPendingInstall) {
      log.debug({ version: info.version }, 'Ignoring update-available while install is pending');
      return;
    }
    log.info({ version: info.version }, `Update available: v${info.version}`);
    setStatus({
      state: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', () => {
    if (updateDownloadedPendingInstall) {
      log.debug('Ignoring update-not-available while install is pending');
      return;
    }
    log.info('Already up to date');
    const wasManual = lastCheckWasManual;
    lastCheckWasManual = false;
    setStatus({ state: 'not-available' });
    if (!wasManual) {
      setTimeout(() => {
        if (currentStatus.state === 'not-available') {
          setStatus({ state: 'idle' });
        }
      }, 5000);
    }
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    if (updateDownloadedPendingInstall) {
      return;
    }
    setStatus({
      state: 'downloading',
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    updateDownloadedPendingInstall = true;
    // MacUpdater emits before Squirrel has fetched and validated the signed app.
    // Keep the progress UI until the native updater confirms installation readiness.
    if (process.platform === 'darwin') {
      pendingMacVersion = info.version;
      const progress = currentStatus.state === 'downloading' ? currentStatus : null;
      setStatus({
        state: 'downloading',
        percent: 100,
        bytesPerSecond: 0,
        transferred: progress?.total ?? 0,
        total: progress?.total ?? 0,
      });
      log.info({ version: info.version }, 'Update downloaded; waiting for macOS validation');
      return;
    }
    log.info({ version: info.version }, `Update downloaded: v${info.version}. Ready to install.`);
    setStatus({ state: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err: Error) => {
    updateDownloadedPendingInstall = false;
    pendingMacVersion = null;
    log.error({ err }, `Auto-updater error: ${err.message}`);
    // Keep failures visible until a recheck, including duplicate native error events.
    setStatus({ state: 'error', message: err.message });
  });

  setTimeout(() => {
    checkForUpdates(false);
  }, CHECK_DELAY_MS);

  checkTimer = setInterval(() => {
    checkForUpdates(false);
  }, CHECK_INTERVAL_MS);

  log.info('Auto-updater initialized');
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus;
}

/** Whether a build is downloaded and waiting for quit / restart (Squirrel.Mac staged update). */
export function hasPendingInstall(): boolean {
  return updateDownloadedPendingInstall;
}

export function checkForUpdates(manual = false): void {
  if (!app.isPackaged) {
    return;
  }
  if (updateDownloadedPendingInstall) {
    log.debug('Skipping update check: downloaded update awaiting install');
    return;
  }
  // After `update-available`, autoDownload runs asynchronously while `checkForUpdatesPromise`
  // is already cleared — another check can run in parallel. A failing second metadata fetch
  // emits `error` and replaces "new version" / progress UI with a spurious error.
  if (currentStatus.state === 'downloading' || currentStatus.state === 'available') {
    log.debug({ state: currentStatus.state, manual }, 'Skipping update check: update fetch or download already in progress');
    return;
  }
  lastCheckWasManual = manual;
  void autoUpdater.checkForUpdates().catch((err) => {
    log.warn({ err, manual }, 'Update check failed');
  });
}

export function quitAndInstall(): void {
  if (!updateDownloadedPendingInstall || currentStatus.state !== 'downloaded') {
    log.warn({ state: currentStatus.state }, 'quitAndInstall called but no update is ready to install');
    return;
  }
  log.info('Quitting and installing update...');
  bypassNextAppQuitConfirmation();
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

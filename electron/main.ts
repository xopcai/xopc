import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BrowserWindow,
  Menu,
  app,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  session,
  shell,
  type BrowserWindowConstructorOptions,
} from 'electron';

/** Before config loader initializes pino (thread-stream worker path breaks when bundled under `out/main/`). */
import './thread-stream-bundle-shim.js';

import { ensureGatewayConfigForElectron, getElectronUserPaths } from './ensure-gateway-config.js';
import {
  isCliBundlePresent,
  spawnGatewayProcess,
  stopGatewayProcess,
  registerEmbeddedGatewayRuntime,
  restartEmbeddedGatewayFromSavedConfig,
  waitForGatewayReady,
  type GatewayProcessOptions,
} from './gateway-process.js';
import { registerAgentIpc } from './ipc/agent-ipc.js';
import { registerFileIpc } from './ipc/file-ipc.js';
import { registerSearchIpc } from './ipc/search-ipc.js';
import { initElectronShellPreferences, registerSystemSettingsIpc, stopAllPowerSaveBlockers } from './ipc/system-settings-ipc.js';
import { registerCronDisplayWakeIpc, stopCronDisplayWakeBlocker } from './ipc/cron-display-wake-ipc.js';
import { registerUpdaterIpc } from './ipc/updater-ipc.js';
import { getLoadingPageDataUrl } from './loading-page.js';
import { hasPendingInstall, initAutoUpdater, stopAutoUpdater } from './auto-updater.js';
import { buildAppMenu } from './menu.js';
import {
  maybeAutoStartTunnel,
  registerTunnelPowerMonitor,
  setEmbeddedGatewayCredentials,
  startTunnelStatusPolling,
  stopTunnelStatusPolling,
} from './tunnel-main.js';
import { createTray, destroyTray } from './tray.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Track the main window for gateway exit notifications. */
let mainWindow: BrowserWindow | null = null;

/** Matches gateway console `h-14` (56px) with Windows `titleBarOverlay`. */
const WIN_TITLEBAR_OVERLAY_HEIGHT = 56;

function win32TitleBarOverlayColors(): { color: string; symbolColor: string; height: number } {
  const dark = nativeTheme.shouldUseDarkColors;
  return {
    color: dark ? '#1c1c1e' : '#f5f5f7',
    symbolColor: dark ? '#f5f5f7' : '#1d1d1f',
    height: WIN_TITLEBAR_OVERLAY_HEIGHT,
  };
}

function browserWindowChromeOptions(): Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'titleBarOverlay'> {
  if (process.platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset' };
  }
  if (process.platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: win32TitleBarOverlayColors(),
    };
  }
  return {};
}

const MACOS_WINDOW_BUTTON_X = 16;
const MACOS_WINDOW_BUTTON_Y = 19;

function applyDarwinWindowButtonPosition(win: BrowserWindow): void {
  if (process.platform !== 'darwin') return;
  try {
    if (win.isFullScreen()) {
      win.setWindowButtonPosition(null);
    } else {
      win.setWindowButtonPosition({ x: MACOS_WINDOW_BUTTON_X, y: MACOS_WINDOW_BUTTON_Y });
    }
  } catch {
    /* hiddenInset / OS build may not support custom placement */
  }
}

let winTitleBarThemeListenerAttached = false;

function ensureWin32TitleBarOverlayThemeSync(): void {
  if (winTitleBarThemeListenerAttached || process.platform !== 'win32') return;
  winTitleBarThemeListenerAttached = true;
  nativeTheme.on('updated', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setTitleBarOverlay(win32TitleBarOverlayColors());
  });
}

if (process.platform === 'win32') {
  app.setAppUserModelId('ai.xopc.xopc');
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('xopc', process.execPath, [process.argv[1]!]);
  }
} else {
  app.setAsDefaultProtocolClient('xopc');
}

function handleDeepLink(url: string): void {
  try {
    const parsed = new URL(url);
    const path = `/${parsed.hostname}${parsed.pathname}`;
    const queryString = parsed.search;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('menu:navigate', path + queryString);
    }
  } catch {
    console.warn(`[main] Invalid deep link URL: ${url}`);
  }
}

if (process.platform === 'darwin') {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

if (gotTheLock) {
  app.on('second-instance', (_event, commandLine) => {
    const url = commandLine.find((arg) => arg.startsWith('xopc://'));
    if (url) handleDeepLink(url);

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

/** True while `before-quit` has run so window `close` does not call `preventDefault` during a normal quit. */
let appIsQuitting = false;

/** Track if gateway exited unexpectedly so we can show an error dialog. */
let gatewayExitedUnexpectedly = false;

/** Dev / unpackaged: window icon (Linux/Windows). Packaged apps use the bundle icon from electron-builder. */
const devWindowIcon = join(__dirname, '../../electron/resources/icon.png');

/**
 * Open off-origin http(s) links in the system browser instead of replacing the app window /
 * spawning an in-app BrowserWindow (e.g. chat markdown with target=_blank).
 */
function attachExternalUrlHandlers(win: BrowserWindow): void {
  const wc = win.webContents;

  wc.setWindowOpenHandler((details) => {
    try {
      const next = new URL(details.url);
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return { action: 'allow' };
      }
      const curHref = wc.getURL();
      if (!curHref || curHref === 'about:blank') {
        return { action: 'allow' };
      }
      const cur = new URL(curHref);
      if (next.origin !== cur.origin) {
        void shell.openExternal(details.url);
        return { action: 'deny' };
      }
    } catch {
      /* ignore */
    }
    return { action: 'allow' };
  });

  wc.on('will-navigate', (event, navigationUrl) => {
    try {
      const next = new URL(navigationUrl);
      if (next.protocol !== 'http:' && next.protocol !== 'https:') return;
      const curHref = wc.getURL();
      if (!curHref || curHref === 'about:blank') return;
      const cur = new URL(curHref);
      if (next.origin !== cur.origin) {
        event.preventDefault();
        void shell.openExternal(navigationUrl);
      }
    } catch {
      /* ignore */
    }
  });
}

function shouldEmbedGateway(): boolean {
  if (process.env['ELECTRON_RENDERER_URL']) return false;
  const force = process.env['ELECTRON_EMBED_GATEWAY'] === '1';
  return (app.isPackaged || force) && isCliBundlePresent();
}

function buildStartupFailureMessage(detail: string): string {
  return (
    `Failed to start the local gateway.\n\n${detail}\n\n` +
    'The app picks a free port starting at 28790 when possible (CLI default is 18790). If startup still fails, quit other xopc or gateway processes, then restart.\n\n' +
    '(Developers: pnpm run build && pnpm run electron:vite:build && pnpm run electron:server:build)'
  );
}

async function resolveWindowLoad(): Promise<
  { kind: 'url'; href: string; openDevTools: boolean } | { kind: 'file'; path: string }
> {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    return { kind: 'url', href: devUrl, openDevTools: true };
  }

  if (shouldEmbedGateway()) {
    const paths = getElectronUserPaths();
    const { port, token, bind } = await ensureGatewayConfigForElectron(paths);
    try {
      const spawnOpts: GatewayProcessOptions = {
        configPath: paths.configPath,
        workspacePath: paths.workspacePath,
        port,
        bind,
        onUnexpectedExit: (code, signal) => {
          gatewayExitedUnexpectedly = true;
          console.error(`[main] Gateway exited unexpectedly: code=${code}, signal=${signal}`);

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('gateway:exited', { code, signal });
          } else {
            void dialog.showErrorBox(
              'xopc - Gateway stopped',
              `The gateway process stopped (exit code: ${code ?? 'unknown'}, signal: ${signal ?? 'none'}).\n\n` +
                'Restart the application.',
            );
          }
        },
      };
      const child = spawnGatewayProcess(spawnOpts);
      await waitForGatewayReady(port, token, child);
      registerEmbeddedGatewayRuntime({ ...spawnOpts, authToken: token });
      setEmbeddedGatewayCredentials(port, token);
      void maybeAutoStartTunnel();
      startTunnelStatusPolling();
    } catch (e) {
      stopGatewayProcess();
      throw e;
    }
    const u = new URL(`http://127.0.0.1:${port}/`);
    u.searchParams.set('token', token);
    u.hash = '#/chat';
    return { kind: 'url', href: u.toString(), openDevTools: false };
  }

  return { kind: 'file', path: join(__dirname, '../renderer/index.html') };
}

/** Send navigate IPC once the window can receive it (handles tray actions after window was closed). */
function navigateMainWindow(hashPath: string): void {
  const needNew = !mainWindow || mainWindow.isDestroyed();
  if (needNew) {
    createWindow();
  }
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  win.show();
  win.focus();
  const path = hashPath.startsWith('/') ? hashPath : `/${hashPath}`;
  const send = () => {
    if (!win.isDestroyed()) {
      win.webContents.send('menu:navigate', path);
    }
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function focusOrCreateMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    /** Allows renderer `Element.requestFullscreen()` (file preview) like Chromium. */
    fullscreenable: true,
    ...browserWindowChromeOptions(),
    ...(!app.isPackaged && existsSync(devWindowIcon) ? { icon: devWindowIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;

  if (process.platform === 'darwin') {
    applyDarwinWindowButtonPosition(win);
    win.once('ready-to-show', () => {
      applyDarwinWindowButtonPosition(win);
    });
    win.on('enter-full-screen', () => {
      try {
        win.setWindowButtonPosition(null);
      } catch {
        /* ignore */
      }
    });
    win.on('leave-full-screen', () => {
      applyDarwinWindowButtonPosition(win);
    });
  }

  ensureWin32TitleBarOverlayThemeSync();

  Menu.setApplicationMenu(buildAppMenu(win));

  const trayIconDir = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(__dirname, '../../electron/resources');
  createTray(trayIconDir, {
    showWindow: () => {
      focusOrCreateMainWindow();
    },
    navigate: (hashPath) => {
      navigateMainWindow(hashPath);
    },
    quit: () => {
      app.quit();
    },
  });

  initAutoUpdater(win);

  attachExternalUrlHandlers(win);

  // Squirrel.Mac only finishes installing when the app process quits. Closing the last window does not call
  // `app.quit()` on macOS by default, so a pending update would never apply after a red-traffic-light close.
  win.on('close', (e) => {
    if (process.platform !== 'darwin' || !app.isPackaged || appIsQuitting || !hasPendingInstall()) {
      return;
    }
    e.preventDefault();
    app.quit();
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  void (async () => {
    const embed = shouldEmbedGateway();
    try {
      if (embed) {
        void win.loadURL(getLoadingPageDataUrl(app.getLocale()));
      }
      const load = await resolveWindowLoad();
      if (gatewayExitedUnexpectedly) {
        return;
      }
      if (load.kind === 'url') {
        void win.loadURL(load.href);
        if (load.openDevTools) {
          win.webContents.openDevTools({ mode: 'detach' });
        }
      } else {
        void win.loadFile(load.path);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (embed && !win.isDestroyed()) {
        win.webContents.send('startup:failed', { message: msg });
      }
      void dialog.showErrorBox('xopc', buildStartupFailureMessage(msg));
      app.quit();
    }
  })();
}

app.whenReady().then(async () => {
  if (!gotTheLock) return;

  // getUserMedia / MediaRecorder need Chromium "media" permission; without handlers some Electron
  // builds deny it for packaged apps (browser tabs are unaffected).
  const allowShellPermission = (permission: string) =>
    permission === 'media' ||
    permission === 'audioCapture' ||
    permission === 'videoCapture' ||
    permission === 'notifications';

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return allowShellPermission(permission);
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowShellPermission(permission));
  });

  await initElectronShellPreferences();
  registerFileIpc(ipcMain);
  registerSearchIpc(ipcMain);
  registerAgentIpc(ipcMain);
  registerSystemSettingsIpc(ipcMain);
  registerCronDisplayWakeIpc(ipcMain);
  registerUpdaterIpc(ipcMain);

  ipcMain.handle('clipboard:write-text', (_event, text: unknown) => {
    if (typeof text !== 'string' || !text) return false;
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle('clipboard:read-text', () => clipboard.readText());

  ipcMain.handle('gateway:restart', async () => {
    if (!shouldEmbedGateway()) {
      return { ok: false, message: 'Embedded gateway is not active in this session.' };
    }
    try {
      const paths = getElectronUserPaths();
      const { port, token } = await restartEmbeddedGatewayFromSavedConfig({
        configPath: paths.configPath,
        workspacePath: paths.workspacePath,
        resolveCredentials: () => ensureGatewayConfigForElectron(paths),
      });
      setEmbeddedGatewayCredentials(port, token);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  });

  registerTunnelPowerMonitor();

  const hotkey = process.platform === 'darwin' ? 'Command+Shift+Space' : 'Control+Shift+Space';
  const registered = globalShortcut.register(hotkey, () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  if (!registered) {
    console.warn(`[main] Failed to register global shortcut: ${hotkey}`);
  }

  createWindow();

  const startupLink = process.argv.find((arg) => arg.startsWith('xopc://'));
  if (startupLink) handleDeepLink(startupLink);
});

app.on('before-quit', () => {
  appIsQuitting = true;
  destroyTray();
  globalShortcut.unregisterAll();
  stopAllPowerSaveBlockers();
  stopCronDisplayWakeBlocker();
  stopTunnelStatusPolling();
  stopGatewayProcess();
  stopAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

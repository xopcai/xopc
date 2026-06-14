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
import { initElectronShellPreferences, isShellNotificationGranted, registerSystemSettingsIpc, stopAllPowerSaveBlockers } from './ipc/system-settings-ipc.js';
import { isShellChromiumPermissionGranted } from './ipc/shell-permission-gates.js';
import { registerCronDisplayWakeIpc, stopCronDisplayWakeBlocker } from './ipc/cron-display-wake-ipc.js';
import { registerUpdaterIpc } from './ipc/updater-ipc.js';
import { getLoadingPageDataUrl } from './loading-page.js';
import { isEmbeddedGatewayLoopbackUrl } from './loopback-url.js';
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
import {
  appendElectronStartupLog,
  devToolsGlobalShortcutAccelerator,
  openMainWindowDevTools,
  shouldAutoOpenDevTools,
  toggleMainWindowDevTools,
} from './devtools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Track the main window for gateway exit notifications. */
let mainWindow: BrowserWindow | null = null;

function browserWindowChromeOptions(): Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'titleBarOverlay'> {
  if (process.platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset' };
  }
  // Windows/Linux: native frame so File/Edit/View menu bar and caption buttons use OS defaults.
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
      // Embedded gateway console always stays in-app on loopback.
      if (isEmbeddedGatewayLoopbackUrl(details.url)) {
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
      // Startup: data: loading page → http://127.0.0.1:<port>/ must stay in-window.
      // Without this, Windows Electron preventDefault() leaves a blank white shell while
      // the gateway UI opens in the system browser.
      if (isEmbeddedGatewayLoopbackUrl(navigationUrl)) {
        return;
      }
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

async function loadMainWindowUrl(win: BrowserWindow, href: string): Promise<void> {
  await win.loadURL(href);
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
    // Browser-extension artifact install runs inside the gateway subprocess (see
    // gateway/service.ts → ensureBrowserExtensionOnStartup). Main does not import src/.
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
    openDevTools: () => {
      focusOrCreateMainWindow();
      toggleMainWindowDevTools(mainWindow);
    },
    quit: () => {
      app.quit();
    },
  });

  initAutoUpdater(win);

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    const msg = `did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL}`;
    console.error(`[main] Window failed to load (${errorCode} ${errorDescription}): ${validatedURL}`);
    appendElectronStartupLog(msg);
    if (shouldAutoOpenDevTools()) {
      openMainWindowDevTools(win);
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    const msg = `render-process-gone reason=${details.reason} exitCode=${details.exitCode}`;
    console.error(`[main] Renderer process gone: ${details.reason} (exitCode=${details.exitCode})`);
    appendElectronStartupLog(msg);
    if (shouldAutoOpenDevTools()) {
      openMainWindowDevTools(win);
    }
  });

  win.webContents.on('did-finish-load', () => {
    appendElectronStartupLog(`did-finish-load url=${win.webContents.getURL()}`);
  });

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

  let externalUrlHandlersAttached = false;
  const attachExternalUrlHandlersOnce = (): void => {
    if (externalUrlHandlersAttached || win.isDestroyed()) return;
    externalUrlHandlersAttached = true;
    attachExternalUrlHandlers(win);
  };

  void (async () => {
    const embed = shouldEmbedGateway();
    try {
      if (embed) {
        await loadMainWindowUrl(win, getLoadingPageDataUrl(app.getLocale()));
      }
      const load = await resolveWindowLoad();
      if (gatewayExitedUnexpectedly) {
        return;
      }
      if (load.kind === 'url') {
        appendElectronStartupLog(`loading gateway url=${load.href}`);
        await loadMainWindowUrl(win, load.href);
        if (load.openDevTools || shouldAutoOpenDevTools()) {
          openMainWindowDevTools(win);
        }
      } else {
        await win.loadFile(load.path);
        if (shouldAutoOpenDevTools()) {
          openMainWindowDevTools(win);
        }
      }
      // Install link guards only after the first document is loaded. Startup uses main-process
      // loadURL (data: loading page → loopback gateway SPA); deferring avoids any chance that
      // will-navigate / window.open handlers interfere with that transition on Windows.
      attachExternalUrlHandlersOnce();
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

  // Align Chromium media / screen capture with OS privacy before granting renderer access.
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === 'notifications') {
      return isShellNotificationGranted();
    }
    return isShellChromiumPermissionGranted(permission);
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'notifications') {
      callback(isShellNotificationGranted());
      return;
    }
    callback(isShellChromiumPermissionGranted(permission));
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
      return { ok: true, token, port };
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

  const devToolsHotkey = devToolsGlobalShortcutAccelerator();
  const devToolsRegistered = globalShortcut.register(devToolsHotkey, () => {
    toggleMainWindowDevTools(mainWindow);
  });
  if (!devToolsRegistered) {
    console.warn(`[main] Failed to register global shortcut: ${devToolsHotkey}`);
  }

  appendElectronStartupLog(`app ready platform=${process.platform} packaged=${app.isPackaged}`);

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

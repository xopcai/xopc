import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  BrowserWindow,
  Menu,
  app,
  clipboard,
  crashReporter,
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
  resolveCliEntry,
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
import { getLoadingPageDataUrl, getRendererCrashPageDataUrl } from './loading-page.js';
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

/** Track the main window for gateway exit notifications. */
let mainWindow: BrowserWindow | null = null;

let crashReporterStarted = false;
let rendererCrashReloadAttempted = false;
let lastGatewayConsoleHref: string | null = null;
let rendererCrashExternalOpened = false;

function redactUrlForLog(href: string): string {
  if (href.startsWith('data:')) {
    return `data:<${href.length} chars>`;
  }
  try {
    const url = new URL(href);
    if (url.searchParams.has('token')) {
      url.searchParams.set('token', '[redacted]');
    }
    return url.toString();
  } catch {
    return href.length > 300 ? `${href.slice(0, 300)}...` : href;
  }
}

function windowStateForLog(win: BrowserWindow): string {
  const wc = win.webContents;
  const isCrashed =
    typeof (wc as { isCrashed?: () => boolean }).isCrashed === 'function'
      ? (wc as { isCrashed: () => boolean }).isCrashed()
      : false;
  return `url=${redactUrlForLog(wc.getURL() || 'about:blank')} loading=${wc.isLoading()} crashed=${isCrashed}`;
}

function appendWindowLifecycleLog(win: BrowserWindow, eventName: string, detail?: string): void {
  appendElectronStartupLog(
    `window ${eventName}${detail ? ` ${detail}` : ''} ${windowStateForLog(win)}`,
  );
}

function startLocalCrashReporter(): void {
  if (process.env['XOPC_ELECTRON_CRASH_REPORTER'] === '0') return;
  try {
    crashReporter.start({
      uploadToServer: false,
      globalExtra: {
        product: 'xopc',
        platform: process.platform,
        packaged: String(app.isPackaged),
      },
    });
    crashReporterStarted = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendElectronStartupLog(`crashReporter start failed: ${message}`);
  }
}

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

const win32StabilityMode = process.env['XOPC_ELECTRON_STABILITY_MODE'] === '1';
const win32UseSoftwareRendering =
  process.env['XOPC_ELECTRON_DISABLE_GPU'] === '1' || win32StabilityMode;
const win32UseJitless =
  process.env['XOPC_ELECTRON_DISABLE_JIT'] === '1' || win32StabilityMode;
const win32DisableSandbox =
  process.env['XOPC_ELECTRON_DISABLE_SANDBOX'] === '1' || win32StabilityMode;

if (process.platform === 'win32') {
  app.setAppUserModelId('ai.xopc.xopc');
  // Keep the default Windows renderer close to macOS/Linux. The broad software-rendering
  // fallback below is useful on some locked-down hosts, but on others it triggers Chromium
  // SwiftShader crashes while loading chat. Leave it opt-in instead of changing the normal UI.
  app.commandLine.appendSwitch(
    'disable-features',
    [
      // RendererCodeIntegrity is a common source of Windows Electron
      // 0xC0000005 crashes when security/overlay DLLs inject into Chromium.
      'RendererCodeIntegrity',
      'CalculateNativeWinOcclusion',
    ].join(','),
  );
  if (win32UseSoftwareRendering) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    app.commandLine.appendSwitch('disable-gpu-rasterization');
    app.commandLine.appendSwitch('disable-accelerated-2d-canvas');
    app.commandLine.appendSwitch('disable-accelerated-video-decode');
    app.commandLine.appendSwitch('disable-direct-composition');
    app.commandLine.appendSwitch('disable-zero-copy');
    app.commandLine.appendSwitch('disable-vulkan');
    app.commandLine.appendSwitch('use-angle', 'swiftshader');
  }
  if (win32UseJitless) {
    // Some Windows Server / security-software combinations crash Chromium's
    // renderer in V8 JIT code with 0xC0000005. Keep this opt-in because chat's
    // React editor and streaming path should match macOS by default.
    app.commandLine.appendSwitch('js-flags', '--jitless');
  }
  if (win32DisableSandbox) {
    // Last-resort stability path for locked-down Windows hosts. The desktop
    // renderer already has nodeIntegration=false and contextIsolation=true.
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('disable-setuid-sandbox');
  }
}

startLocalCrashReporter();

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
const devWindowIcon = join(import.meta.dirname, '../../electron/resources/icon.png');

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
  return app.isPackaged || force;
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
    if (!isCliBundlePresent()) {
      throw new Error(`Embedded gateway bundle is missing: ${resolveCliEntry()}`);
    }
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

  return { kind: 'file', path: join(import.meta.dirname, '../renderer/index.html') };
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
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep preload in the classic isolated context. The preload intentionally uses
      // Electron IPC and process.platform; explicitly pinning this avoids Electron
      // default changes from moving it into a stricter sandbox on Windows builds.
      sandbox: false,
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

  // Notify renderer of OS-level fullscreen changes so the file-preview pane can sync its UI state.
  win.on('enter-full-screen', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window:fullscreen-changed', true);
    }
  });
  win.on('leave-full-screen', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window:fullscreen-changed', false);
    }
  });

  Menu.setApplicationMenu(buildAppMenu(win));

  const trayIconDir = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(import.meta.dirname, '../../electron/resources');
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

  appendWindowLifecycleLog(win, 'created');

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    appendElectronStartupLog(`renderer console level=${level} source=${sourceId}:${line} ${message}`);
  });

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    appendElectronStartupLog(
      `preload-error path=${preloadPath} name=${error.name} message=${error.message} stack=${error.stack ?? ''}`,
    );
  });

  win.webContents.on('did-start-loading', () => {
    appendWindowLifecycleLog(win, 'did-start-loading');
  });

  win.webContents.on('dom-ready', () => {
    appendWindowLifecycleLog(win, 'dom-ready');
  });

  win.webContents.on('did-stop-loading', () => {
    appendWindowLifecycleLog(win, 'did-stop-loading');
  });

  win.webContents.on('did-start-navigation', (_event, navigationUrl, isSameDocument, isMainFrame) => {
    if (!isMainFrame) return;
    appendWindowLifecycleLog(
      win,
      'did-start-navigation',
      `target=${redactUrlForLog(navigationUrl)} sameDocument=${isSameDocument}`,
    );
  });

  win.webContents.on('did-navigate', (_event, navigationUrl) => {
    appendWindowLifecycleLog(win, 'did-navigate', `target=${redactUrlForLog(navigationUrl)}`);
  });

  win.webContents.on('did-frame-finish-load', (_event, isMainFrame) => {
    if (!isMainFrame) return;
    appendWindowLifecycleLog(win, 'did-frame-finish-load');
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    const msg = `did-fail-load code=${errorCode} desc=${errorDescription} url=${redactUrlForLog(validatedURL)} ${windowStateForLog(win)}`;
    console.error(`[main] Window failed to load (${errorCode} ${errorDescription}): ${validatedURL}`);
    appendElectronStartupLog(msg);
    if (shouldAutoOpenDevTools()) {
      openMainWindowDevTools(win);
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    const msg =
      `render-process-gone reason=${details.reason} exitCode=${details.exitCode} ` +
      `${windowStateForLog(win)} crashReporter=${crashReporterStarted} crashDumps=${app.getPath('crashDumps')}`;
    console.error(`[main] Renderer process gone: ${details.reason} (exitCode=${details.exitCode})`);
    appendElectronStartupLog(msg);
    if (!appIsQuitting && details.reason === 'crashed') {
      if (!rendererCrashReloadAttempted) {
        rendererCrashReloadAttempted = true;
        appendElectronStartupLog('renderer crash recovery: reloading main window once');
        setTimeout(() => {
          if (!win.isDestroyed()) {
            win.reload();
          }
        }, 500);
      } else {
        appendElectronStartupLog('renderer crash recovery: showing diagnostic page after repeated crash');
        const externalHref = lastGatewayConsoleHref || win.webContents.getURL();
        const canOpenExternal = isEmbeddedGatewayLoopbackUrl(externalHref);
        if (canOpenExternal && !rendererCrashExternalOpened) {
          rendererCrashExternalOpened = true;
          appendElectronStartupLog(
            `renderer crash fallback: opening default browser url=${redactUrlForLog(externalHref)}`,
          );
          void shell.openExternal(externalHref).catch((err) => {
            const em = err instanceof Error ? err.message : String(err);
            appendElectronStartupLog(`renderer crash fallback openExternal failed: ${em}`);
          });
        } else if (!canOpenExternal) {
          appendElectronStartupLog(
            `renderer crash fallback skipped: non-loopback url=${redactUrlForLog(externalHref)}`,
          );
        }
        setTimeout(() => {
          if (!win.isDestroyed()) {
            void win
              .loadURL(getRendererCrashPageDataUrl(app.getLocale(), msg, { openedExternal: canOpenExternal }))
              .catch((err) => {
                const em = err instanceof Error ? err.message : String(err);
                appendElectronStartupLog(`renderer crash diagnostic page failed: ${em}`);
              });
          }
        }, 500);
      }
    }
    if (shouldAutoOpenDevTools()) {
      setImmediate(() => openMainWindowDevTools(win));
    }
  });

  win.webContents.on('did-finish-load', () => {
    appendWindowLifecycleLog(win, 'did-finish-load');
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
      if (embed || app.isPackaged) {
        await loadMainWindowUrl(win, getLoadingPageDataUrl(app.getLocale()));
      }
      const load = await resolveWindowLoad();
      if (gatewayExitedUnexpectedly) {
        return;
      }
      if (load.kind === 'url') {
        appendElectronStartupLog(`loading gateway url=${redactUrlForLog(load.href)}`);
        if (isEmbeddedGatewayLoopbackUrl(load.href)) {
          lastGatewayConsoleHref = load.href;
        }
        await loadMainWindowUrl(win, load.href);
        if (load.openDevTools || shouldAutoOpenDevTools()) {
          openMainWindowDevTools(win);
        }
      } else {
        lastGatewayConsoleHref = null;
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

  ipcMain.on('preload:ready', (event, payload: unknown) => {
    const href =
      payload && typeof payload === 'object' && 'href' in payload && typeof payload.href === 'string'
        ? payload.href
        : event.sender.getURL();
    appendElectronStartupLog(`preload ready url=${redactUrlForLog(href || 'about:blank')}`);
  });

  ipcMain.on('preload:dom-content-loaded', (event, payload: unknown) => {
    const href =
      payload && typeof payload === 'object' && 'href' in payload && typeof payload.href === 'string'
        ? payload.href
        : event.sender.getURL();
    appendElectronStartupLog(`preload dom-content-loaded url=${redactUrlForLog(href || 'about:blank')}`);
  });

  ipcMain.handle('clipboard:write-text', (_event, text: unknown) => {
    if (typeof text !== 'string' || !text) return false;
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle('clipboard:read-text', () => clipboard.readText());

  ipcMain.handle('window:fullscreen-enter', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.setFullScreen(true);
  });

  ipcMain.handle('window:fullscreen-exit', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.setFullScreen(false);
  });

  ipcMain.handle('window:fullscreen-toggle', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.setFullScreen(!win.isFullScreen());
  });

  ipcMain.handle('window:fullscreen-is', () => {
    const win = BrowserWindow.getFocusedWindow();
    return win ? win.isFullScreen() : false;
  });

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

  appendElectronStartupLog(
    `app ready platform=${process.platform} packaged=${app.isPackaged} ` +
      `electron=${process.versions.electron} chrome=${process.versions.chrome} ` +
      `crashReporter=${crashReporterStarted} crashDumps=${app.getPath('crashDumps')}`,
  );
  if (process.platform === 'win32') {
    appendElectronStartupLog(
      `win32 stability flags gpu=${win32UseSoftwareRendering ? 'software' : 'default'} ` +
        `jit=${win32UseJitless ? 'jitless' : 'default'} ` +
        `sandbox=${win32DisableSandbox ? 'disabled' : 'default'}`,
    );
    appendElectronStartupLog(`gpu feature status=${JSON.stringify(app.getGPUFeatureStatus())}`);
  }

  app.on('child-process-gone', (_event, details) => {
    appendElectronStartupLog(
      `child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode} ` +
        `serviceName=${details.serviceName ?? ''} name=${details.name ?? ''}`,
    );
  });

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

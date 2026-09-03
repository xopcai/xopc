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
  type IpcMainInvokeEvent,
} from 'electron';

/** Before config loader initializes pino (thread-stream worker path breaks when bundled under `out/main/`). */
import './thread-stream-bundle-shim.js';

import { ensureGatewayConfigForElectron, getElectronUserPaths } from './ensure-gateway-config.js';
import { xopcDeepLinkTarget } from './deep-link.js';
import {
  isCliBundlePresent,
  resolveCliEntry,
  resolveGatewayStartupMode,
  spawnGatewayProcess,
  stopGatewayProcess,
  stopGatewayProcessAndWait,
  registerGatewayConnection,
  registerEmbeddedGatewayRuntime,
  getGatewayCredential,
  restartEmbeddedGatewayFromSavedConfig,
  waitForGatewayReady,
  type GatewayProcessOptions,
} from './gateway-process.js';
import { registerAgentIpc } from './ipc/agent-ipc.js';
import { registerUnderstandingSourcesIpc } from './ipc/understanding-sources-ipc.js';
import { registerFileIpc } from './ipc/file-ipc.js';
import { registerSearchIpc } from './ipc/search-ipc.js';
import { registerTerminalIpc, stopAllTerminals } from './ipc/terminal-ipc.js';
import {
  getElectronShellLanguage,
  initElectronShellPreferences,
  isShellNotificationGranted,
  registerSystemSettingsIpc,
  stopAllPowerSaveBlockers,
  shouldKeepAppInBackground,
} from './ipc/system-settings-ipc.js';
import {
  isShellChromiumPermissionGranted,
  isTrustedShellPermissionRequest,
} from './ipc/shell-permission-gates.js';
import { registerCronDisplayWakeIpc, stopCronDisplayWakeBlocker } from './ipc/cron-display-wake-ipc.js';
import { registerUpdaterIpc } from './ipc/updater-ipc.js';
import { registerDesktopPetIpc } from './desktop-pet/ipc.js';
import { normalizeExternalHttpUrl } from './external-url.js';
import { decideElectronNavigation } from './navigation-policy.js';
import {
  destroyDesktopPetWindow,
  initDesktopPetWindow,
  maybeShowDesktopPetOnStartup,
  toggleDesktopPet,
} from './desktop-pet/window.js';
import { assertTrustedRenderer } from './ipc/trusted-renderer.js';
import {
  getLoadingPageDataUrl,
  getRendererCrashPageDataUrl,
  getStartupRecoveryPageDataUrl,
} from './loading-page.js';
import { isEmbeddedGatewayLoopbackUrl } from './loopback-url.js';
import {
  checkForUpdates,
  getUpdateStatus,
  hasPendingInstall,
  initAutoUpdater,
  quitAndInstall,
  stopAutoUpdater,
} from './auto-updater.js';
import { getElectronMenuMessages, type ElectronUiLanguage } from './i18n.js';
import { buildAppMenu, buildAppMenuModel, invokeAppMenuAction } from './menu.js';
import {
  appQuitConfirmationGate,
  bypassNextAppQuitConfirmation,
} from './quit-confirmation.js';
import {
  classifyGatewayStartupFailure,
  enrichGatewayStartupFailure,
  isGatewayStartupError,
  type GatewayStartupFailure,
} from './startup-failure.js';
import type { StartupProgressReporter } from './startup-progress.js';
import {
  maybeAutoStartTunnel,
  registerTunnelPowerMonitor,
  setEmbeddedGatewayCredentials,
  startTunnelStatusPolling,
  stopTunnelStatusPolling,
} from './tunnel-main.js';
import { createTray, destroyTray, updateTrayLanguage } from './tray.js';
import {
  startVoiceInputHotkey,
  stopVoiceInputHotkey,
  type VoiceHotkeyEvent,
} from './voice-input-hotkey.js';
import {
  MAIN_WINDOW_MIN_HEIGHT,
  MAIN_WINDOW_MIN_WIDTH,
  registerMainWindowStatePersistence,
  resolveInitialMainWindowState,
} from './window-state.js';
import {
  appendElectronStartupLog,
  devToolsGlobalShortcutAccelerator,
  openMainWindowDevTools,
  shouldAutoOpenDevTools,
  toggleMainWindowDevTools,
} from './devtools.js';

/** Track the main window for gateway exit notifications. */
let mainWindow: BrowserWindow | null = null;
let mainWindowNavigationReady = false;
let pendingMainWindowNavigation: string | null = null;

let crashReporterStarted = false;
let rendererCrashReloadAttempted = false;
let lastGatewayConsoleHref: string | null = null;
let rendererCrashExternalOpened = false;
let currentStartupFailure: GatewayStartupFailure | null = null;

const debugWindowLifecycle = process.env['XOPC_ELECTRON_DEBUG_LIFECYCLE'] === '1';
const openBrowserOnRendererCrash = process.env['XOPC_ELECTRON_OPEN_BROWSER_ON_CRASH'] === '1';

function currentMenuMessages() {
  return getElectronMenuMessages(getElectronShellLanguage());
}

function refreshElectronMenus(language?: ElectronUiLanguage): void {
  const messages = getElectronMenuMessages(language ?? getElectronShellLanguage());
  if (mainWindow && !mainWindow.isDestroyed()) {
    Menu.setApplicationMenu(buildAppMenu(mainWindow, messages));
    if (process.platform === 'win32') {
      mainWindow.setMenuBarVisibility(false);
    }
    mainWindow.webContents.send('electron-locale:changed', language ?? getElectronShellLanguage());
  }
  updateTrayLanguage(messages);
}

function redactUrlForLog(href: string): string {
  if (href.startsWith('data:')) {
    return `data:<${href.length} chars>`;
  }
  try {
    const url = new URL(href);
    for (const name of ['token', 'code', 'state', 'request_id']) {
      if (url.searchParams.has(name)) url.searchParams.set(name, '[redacted]');
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
  if (!debugWindowLifecycle) return;
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

function browserWindowChromeOptions(): Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'titleBarOverlay' | 'autoHideMenuBar'
> {
  if (process.platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset' };
  }
  if (process.platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#475569',
        height: 36,
      },
      autoHideMenuBar: true,
    };
  }
  // Linux keeps the native frame so menu bar and caption buttons follow the window manager.
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
const win32DisableRendererCodeIntegrity =
  process.env['XOPC_ELECTRON_DISABLE_RENDERER_CODE_INTEGRITY'] === '1' || win32StabilityMode;
const win32DisableNativeWinOcclusion =
  process.env['XOPC_ELECTRON_DISABLE_NATIVE_WIN_OCCLUSION'] === '1' || win32StabilityMode;

if (process.platform === 'win32') {
  app.setAppUserModelId('ai.xopc.xopc');
  // Keep the default Windows renderer close to macOS/Linux. The broad software-rendering
  // fallback below is useful on some locked-down hosts. Leave it opt-in instead
  // of changing the normal UI/security model.
  const disabledFeatures: string[] = [];
  if (win32DisableRendererCodeIntegrity) {
    disabledFeatures.push('RendererCodeIntegrity');
  }
  if (win32DisableNativeWinOcclusion) {
    disabledFeatures.push('CalculateNativeWinOcclusion');
  }
  if (disabledFeatures.length > 0) {
    app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));
  }
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

function handleDeepLink(url: string): boolean {
  const target = xopcDeepLinkTarget(url);
  if (!target) {
    console.warn(`[main] Invalid deep link URL: ${url}`);
    return false;
  }
  if (
    target.focusOnlyWhenReady &&
    mainWindowNavigationReady &&
    mainWindow &&
    !mainWindow.isDestroyed()
  ) {
    focusOrCreateMainWindow();
    return true;
  }
  pendingMainWindowNavigation = target.route;
  if (app.isReady()) navigateMainWindow(target.route);
  return true;
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
let quitCleanupStarted = false;
let quitCleanupComplete = false;
let quitCleanupPromise: Promise<void> | null = null;

async function confirmAppQuit(): Promise<void> {
  const copy = currentMenuMessages().quitConfirmation;
  const options = {
    type: 'warning' as const,
    title: copy.title,
    message: copy.title,
    detail: copy.detail,
    buttons: [copy.cancel, copy.quit],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  };
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  try {
    const result = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options);
    if (appQuitConfirmationGate.resolve(result.response === 1)) {
      app.quit();
    }
  } catch (error) {
    appQuitConfirmationGate.resolve(false);
    const message = error instanceof Error ? error.message : String(error);
    appendElectronStartupLog(`quit confirmation failed: ${message}`);
  }
}

/** Track if gateway exited unexpectedly so we can show an error dialog. */
let gatewayExitedUnexpectedly = false;

/** Dev / unpackaged: window icon (Linux/Windows). Packaged apps use the bundle icon from electron-builder. */
const devWindowIcon = join(import.meta.dirname, '../../electron/resources/icon.png');

/**
 * Open published sites and off-origin http(s) links in the system browser instead of replacing
 * the app window / spawning an in-app BrowserWindow (e.g. chat markdown with target=_blank).
 */
function attachExternalUrlHandlers(win: BrowserWindow): void {
  const wc = win.webContents;
  const openExternal = (url: string) => {
    void shell.openExternal(url).catch((error) => {
      console.warn(`[main] Failed to open external URL: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  wc.setWindowOpenHandler((details) => {
    const decision = decideElectronNavigation(wc.getURL(), details.url);
    if (decision.kind === 'internal-deep-link') {
      handleDeepLink(decision.url);
    } else if (decision.kind === 'same-origin' && decision.route) {
      navigateMainWindow(decision.route);
    } else if (decision.kind === 'external-http') {
      openExternal(decision.url);
    }
    return { action: 'deny' };
  });

  wc.on('will-navigate', (event, navigationUrl) => {
    const decision = decideElectronNavigation(wc.getURL(), navigationUrl);
    if (decision.kind === 'same-origin' && !decision.route) return;

    event.preventDefault();
    if (decision.kind === 'internal-deep-link') {
      handleDeepLink(decision.url);
    } else if (decision.kind === 'same-origin' && decision.route) {
      navigateMainWindow(decision.route);
    } else if (decision.kind === 'external-http') {
      openExternal(decision.url);
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
    'Electron uses the shared xopc gateway configured in ~/.xopc/xopc.json. If the configured port is occupied by another process, stop it or change gateway.port, then restart.\n\n' +
    '(Developers: pnpm run build && pnpm run electron:vite:build && pnpm run electron:server:build && pnpm run electron:extensions:build)'
  );
}

function startupFailureFromError(error: unknown): GatewayStartupFailure {
  if (isGatewayStartupError(error)) {
    return error.failure;
  }
  const message = error instanceof Error ? error.message : String(error);
  return classifyGatewayStartupFailure({ message });
}

function enrichStartupFailureForElectron(failure: GatewayStartupFailure): GatewayStartupFailure {
  const paths = getElectronUserPaths();
  return enrichGatewayStartupFailure(failure, {
    configPath: paths.configPath,
    stateDir: paths.stateDir,
    dbPath: join(paths.stateDir, 'xopc.db'),
    appRelease: app.getVersion(),
    isPackaged: app.isPackaged,
  });
}

async function loadStartupRecoveryPage(
  win: BrowserWindow,
  failure: GatewayStartupFailure,
): Promise<void> {
  currentStartupFailure = enrichStartupFailureForElectron(failure);
  appendElectronStartupLog(`startup recovery kind=${currentStartupFailure.kind} message=${currentStartupFailure.message}`);
  await loadMainWindowUrl(win, getStartupRecoveryPageDataUrl(app.getLocale(), currentStartupFailure));
}

function assertStartupRecoveryRenderer(event: IpcMainInvokeEvent): void {
  if (!currentStartupFailure || !mainWindow || mainWindow.isDestroyed()) {
    throw new Error('No startup recovery session is active');
  }
  if (event.sender !== mainWindow.webContents) {
    throw new Error('IPC denied from non-recovery renderer');
  }
}

async function collectStartupSupportReport(): Promise<string> {
  if (!currentStartupFailure) throw new Error('No startup recovery session is active');
  const { collectSupportReport } = await import('../src/support/collect-support-report.js');
  const paths = getElectronUserPaths();
  const report = await collectSupportReport({
    problem: `Gateway startup failed: ${currentStartupFailure.message}`,
    occurredAt: new Date().toISOString(),
    clientContext: {
      rendererError: JSON.stringify(currentStartupFailure, null, 2),
      surface: 'electron',
    },
  }, {
    paths: {
      configPath: paths.configPath,
      stateDir: paths.stateDir,
      workspaceDir: paths.workspacePath,
    },
  });
  return report.markdown;
}

export function proxyUrlFromElectronSpec(spec: string): string | undefined {
  for (const entry of spec.split(';')) {
    const match = entry.trim().match(/^(?:PROXY|HTTPS?)\s+(.+)$/i);
    if (!match?.[1]) continue;
    try {
      const url = new URL(`http://${match[1].trim()}`);
      if (!url.hostname || !url.port) continue;
      return url.toString();
    } catch {
      // Try the next proxy returned by Chromium.
    }
  }
  return undefined;
}

async function resolveVoiceModelProxyUrl(): Promise<string | undefined> {
  if (
    process.env.HTTPS_PROXY
    || process.env.https_proxy
    || process.env.HTTP_PROXY
    || process.env.http_proxy
  ) {
    return undefined;
  }
  try {
    const spec = await session.defaultSession.resolveProxy('https://huggingface.co');
    return proxyUrlFromElectronSpec(spec);
  } catch {
    return undefined;
  }
}

async function resolveWindowLoad(reportProgress: StartupProgressReporter = () => {}): Promise<
  { kind: 'url'; href: string; openDevTools: boolean } | { kind: 'file'; path: string }
> {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    return { kind: 'url', href: devUrl, openDevTools: true };
  }

  if (shouldEmbedGateway()) {
    reportProgress({ phase: 'preparing-workspace' });
    const paths = getElectronUserPaths();
    const { port, token, bind, bindHost } = await ensureGatewayConfigForElectron(paths);
    // Browser-extension artifact install runs inside the gateway subprocess (see
    // gateway/service.ts → ensureBrowserExtensionOnStartup). Main does not import src/.
    try {
      const proxyUrl = await resolveVoiceModelProxyUrl();
      const spawnOpts: GatewayProcessOptions = {
        configPath: paths.configPath,
        workspacePath: paths.workspacePath,
        port,
        bind,
        ...(proxyUrl ? { proxyUrl } : {}),
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
      reportProgress({ phase: 'checking-core' });
      const startupMode = await resolveGatewayStartupMode({ port, token, bindHost });
      if (startupMode === 'spawn') {
        reportProgress({ phase: 'starting-core' });
        if (!isCliBundlePresent()) {
          throw new Error(`Embedded gateway bundle is missing: ${resolveCliEntry()}`);
        }
        const child = spawnGatewayProcess(spawnOpts);
        reportProgress({ phase: 'connecting-assistant' });
        const readyPort = await waitForGatewayReady(port, token, child);
        registerEmbeddedGatewayRuntime({ ...spawnOpts, port: readyPort, authToken: token });
      }
      setEmbeddedGatewayCredentials(port, token);
      void maybeAutoStartTunnel();
      startTunnelStatusPolling();
      reportProgress({ phase: 'opening-workspace' });
      const u = new URL(`http://127.0.0.1:${port}/`);
      u.hash = '#/chat';
      return { kind: 'url', href: u.toString(), openDevTools: false };
    } catch (e) {
      stopGatewayProcess();
      throw e;
    }
  }

  return { kind: 'file', path: join(import.meta.dirname, '../renderer/index.html') };
}

/** Send navigate IPC once the window can receive it (handles tray actions after window was closed). */
function navigateMainWindow(hashPath: string): void {
  const path = hashPath.startsWith('/') ? hashPath : `/${hashPath}`;
  pendingMainWindowNavigation = path;
  const needNew = !mainWindow || mainWindow.isDestroyed();
  if (needNew) {
    createWindow();
  }
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (!mainWindowNavigationReady) return;
  pendingMainWindowNavigation = null;
  win.webContents.send('menu:navigate', path);
}

function markMainWindowNavigationReady(win: BrowserWindow): void {
  if (win.isDestroyed() || win !== mainWindow) return;
  mainWindowNavigationReady = true;
  if (!pendingMainWindowNavigation) return;
  const path = pendingMainWindowNavigation;
  pendingMainWindowNavigation = null;
  win.webContents.send('menu:navigate', path);
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

function handleVoiceInputSystemHotkey(event: VoiceHotkeyEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send('voice-input:hotkey', event.action);
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function resolveDesktopPetUrl(): string | null {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  const baseHref = rendererUrl || lastGatewayConsoleHref;
  if (!baseHref) return null;
  try {
    const u = new URL(baseHref);
    u.hash = '#/desktop-pet';
    return u.toString();
  } catch {
    return null;
  }
}

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }

  const initialWindowState = resolveInitialMainWindowState();
  const win = new BrowserWindow({
    ...initialWindowState.bounds,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    /** Allows renderer `Element.requestFullscreen()` (file preview) like Chromium. */
    fullscreenable: true,
    ...browserWindowChromeOptions(),
    ...(!app.isPackaged && existsSync(devWindowIcon) ? { icon: devWindowIcon } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      ...(win32DisableSandbox ? { sandbox: false } : {}),
    },
  });

  mainWindow = win;
  mainWindowNavigationReady = false;
  registerMainWindowStatePersistence(win);
  if (initialWindowState.isMaximized) {
    win.maximize();
  }

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

  const menuMessages = currentMenuMessages();
  Menu.setApplicationMenu(buildAppMenu(win, menuMessages));
  if (process.platform === 'win32') {
    win.setMenuBarVisibility(false);
  }

  const trayIconDir = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(import.meta.dirname, '../../electron/resources');
  createTray(
    trayIconDir,
    {
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
      toggleDesktopPet: () => {
        void toggleDesktopPet();
      },
      openDesktopPetSettings: () => {
        navigateMainWindow('/settings/desktop-pet');
      },
      quit: () => {
        app.quit();
      },
    },
    menuMessages,
  );

  initAutoUpdater(win);

  appendWindowLifecycleLog(win, 'created');

  if (debugWindowLifecycle) {
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      appendElectronStartupLog(`renderer console level=${level} source=${sourceId}:${line} ${message}`);
    });
  }

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
        if (openBrowserOnRendererCrash && canOpenExternal && !rendererCrashExternalOpened) {
          rendererCrashExternalOpened = true;
          appendElectronStartupLog(
            `renderer crash fallback: opening default browser url=${redactUrlForLog(externalHref)}`,
          );
          void shell.openExternal(externalHref).catch((err) => {
            const em = err instanceof Error ? err.message : String(err);
            appendElectronStartupLog(`renderer crash fallback openExternal failed: ${em}`);
          });
        } else if (openBrowserOnRendererCrash && !canOpenExternal) {
          appendElectronStartupLog(
            `renderer crash fallback skipped: non-loopback url=${redactUrlForLog(externalHref)}`,
          );
        }
        setTimeout(() => {
          if (!win.isDestroyed()) {
            void win
              .loadURL(
                getRendererCrashPageDataUrl(app.getLocale(), msg, {
                  openedExternal: openBrowserOnRendererCrash && canOpenExternal,
                }),
              )
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

  // Keep the gateway alive only when background operation has a visible tray owner.
  win.on('close', (e) => {
    if (appIsQuitting) {
      return;
    }
    if (shouldKeepAppInBackground() && !(app.isPackaged && hasPendingInstall())) {
      e.preventDefault();
      win.hide();
      return;
    }
    e.preventDefault();
    app.quit();
  });

  win.on('closed', () => {
    mainWindow = null;
    mainWindowNavigationReady = false;
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
      const load = await resolveWindowLoad((detail) => {
        if (!win.isDestroyed()) {
          win.webContents.send('startup:progress', detail);
        }
      });
      if (gatewayExitedUnexpectedly) {
        return;
      }
      // Let the embedded startup page complete its short exit transition before replacing
      // the document. This only runs for embedded/package startup, never the Vite dev renderer.
      if (embed && load.kind === 'url') {
        await new Promise((resolve) => setTimeout(resolve, 140));
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
      markMainWindowNavigationReady(win);
      void maybeShowDesktopPetOnStartup();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (embed && !win.isDestroyed()) {
        await loadStartupRecoveryPage(win, startupFailureFromError(e));
        return;
      }
      void dialog.showErrorBox('xopc', buildStartupFailureMessage(msg));
      bypassNextAppQuitConfirmation();
      app.quit();
    }
  })();
}

app.whenReady().then(async () => {
  if (!gotTheLock) return;

  // Align Chromium media / screen capture with OS privacy before granting renderer access.
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const trusted = isTrustedShellPermissionRequest([
      webContents?.getURL(),
      requestingOrigin,
      details.requestingUrl,
      details.securityOrigin,
      details.embeddingOrigin,
    ]);
    if (!trusted) return false;
    if (permission === 'notifications') {
      return isShellNotificationGranted();
    }
    return isShellChromiumPermissionGranted(permission, details);
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = 'requestingUrl' in details ? details.requestingUrl : undefined;
    const securityOrigin = 'securityOrigin' in details ? details.securityOrigin : undefined;
    const trusted = isTrustedShellPermissionRequest([
      webContents.getURL(),
      requestingUrl,
      securityOrigin,
    ]);
    if (!trusted) {
      callback(false);
      return;
    }
    if (permission === 'notifications') {
      callback(isShellNotificationGranted());
      return;
    }
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
    callback(isShellChromiumPermissionGranted(permission, { mediaTypes }));
  });

  await initElectronShellPreferences();
  const electronUserPaths = getElectronUserPaths();
  const gatewayConfig = await ensureGatewayConfigForElectron(electronUserPaths);
  registerGatewayConnection({ port: gatewayConfig.port, token: gatewayConfig.token });
  const { fileIpcRoots } = gatewayConfig;
  registerFileIpc(ipcMain, { allowedRoots: fileIpcRoots });
  registerSearchIpc(ipcMain, { allowedRoots: fileIpcRoots });
  registerAgentIpc(ipcMain);
  registerTerminalIpc(ipcMain);
  registerUnderstandingSourcesIpc(ipcMain);
  registerSystemSettingsIpc(ipcMain, {
    onLanguageChanged: (language) => {
      refreshElectronMenus(language);
    },
    isMainWindowFocused: () => Boolean(
      mainWindow
      && !mainWindow.isDestroyed()
      && mainWindow.isVisible()
      && !mainWindow.isMinimized()
      && mainWindow.isFocused(),
    ),
    navigateMainWindow,
  });
  initDesktopPetWindow({
    resolveUrl: resolveDesktopPetUrl,
    openMainWindow: (hashPath) => {
      if (hashPath) {
        navigateMainWindow(hashPath);
      } else {
        focusOrCreateMainWindow();
      }
    },
    disableSandbox: win32DisableSandbox,
  });
  registerDesktopPetIpc(ipcMain);
  registerCronDisplayWakeIpc(ipcMain);
  registerUpdaterIpc(ipcMain);

  ipcMain.on('preload:ready', (event, payload: unknown) => {
    if (!debugWindowLifecycle) return;
    const href =
      payload && typeof payload === 'object' && 'href' in payload && typeof payload.href === 'string'
        ? payload.href
        : event.sender.getURL();
    appendElectronStartupLog(`preload ready url=${redactUrlForLog(href || 'about:blank')}`);
  });

  ipcMain.on('preload:dom-content-loaded', (event, payload: unknown) => {
    if (!debugWindowLifecycle) return;
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

  ipcMain.handle('shell:open-external-url', async (event, rawUrl: unknown) => {
    assertTrustedRenderer(event);
    try {
      await shell.openExternal(normalizeExternalHttpUrl(rawUrl));
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : 'Failed to open the system browser',
      };
    }
  });

  ipcMain.handle('menu:get-model', (event) => {
    assertTrustedRenderer(event);
    return buildAppMenuModel(currentMenuMessages(), process.platform);
  });

  ipcMain.handle('menu:invoke', (event, actionId: unknown) => {
    assertTrustedRenderer(event);
    if (typeof actionId !== 'string' || !actionId) {
      return { ok: false as const, error: 'UNKNOWN_MENU_ACTION' as const };
    }
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!win || win.isDestroyed()) {
      return { ok: false as const, error: 'UNKNOWN_MENU_ACTION' as const };
    }
    return invokeAppMenuAction(win, actionId);
  });

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

  ipcMain.handle('gateway:restart', async (event) => {
    assertTrustedRenderer(event);
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

  ipcMain.handle('gateway:get-credential', (event) => {
    assertTrustedRenderer(event);
    return getGatewayCredential();
  });

  ipcMain.handle('startup:get-diagnostic', (event) => {
    assertStartupRecoveryRenderer(event);
    return currentStartupFailure;
  });

  ipcMain.handle('startup:copy-diagnostic', async (event) => {
    assertStartupRecoveryRenderer(event);
    try {
      clipboard.writeText(await collectStartupSupportReport());
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('startup:open-data-dir', async (event) => {
    assertStartupRecoveryRenderer(event);
    const target = currentStartupFailure?.stateDir ?? getElectronUserPaths().stateDir;
    const message = await shell.openPath(target);
    return message ? { ok: false, message } : { ok: true };
  });

  ipcMain.handle('startup:get-update-status', (event) => {
    assertStartupRecoveryRenderer(event);
    return getUpdateStatus();
  });

  ipcMain.handle('startup:check-update', (event) => {
    assertStartupRecoveryRenderer(event);
    if (!app.isPackaged) {
      return {
        ok: false,
        message: 'Auto-update is only available in packaged desktop builds. Rebuild this development checkout, then retry.',
      };
    }
    checkForUpdates(true);
    return { ok: true };
  });

  ipcMain.handle('startup:quit-and-install', (event) => {
    assertStartupRecoveryRenderer(event);
    quitAndInstall();
    return { ok: true };
  });

  ipcMain.handle('startup:retry-gateway', async (event) => {
    assertStartupRecoveryRenderer(event);
    if (!shouldEmbedGateway()) {
      return { ok: false, message: 'Embedded gateway is not active in this session.' };
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) {
      return { ok: false, message: 'Recovery window is no longer available.' };
    }
    try {
      const load = await resolveWindowLoad();
      if (load.kind !== 'url') {
        return { ok: false, message: 'Embedded gateway did not return a gateway URL.' };
      }
      currentStartupFailure = null;
      appendElectronStartupLog(`startup recovery retry succeeded url=${redactUrlForLog(load.href)}`);
      if (isEmbeddedGatewayLoopbackUrl(load.href)) {
        lastGatewayConsoleHref = load.href;
      }
      await loadMainWindowUrl(win, load.href);
      attachExternalUrlHandlers(win);
      markMainWindowNavigationReady(win);
      return { ok: true };
    } catch (err) {
      const failure = startupFailureFromError(err);
      await loadStartupRecoveryPage(win, failure);
      return { ok: false, message: failure.message };
    }
  });

  registerTunnelPowerMonitor();
  startVoiceInputHotkey(handleVoiceInputSystemHotkey);

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
        `sandbox=${win32DisableSandbox ? 'disabled' : 'default'} ` +
        `rendererCodeIntegrity=${win32DisableRendererCodeIntegrity ? 'disabled' : 'default'} ` +
        `nativeWinOcclusion=${win32DisableNativeWinOcclusion ? 'disabled' : 'default'}`,
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

app.on('before-quit', (event) => {
  const canConfirm = app.isReady();
  const confirmationStep = appQuitConfirmationGate.begin(canConfirm);
  if (confirmationStep !== 'allow') {
    event.preventDefault();
    if (confirmationStep === 'confirm') {
      void confirmAppQuit();
    }
    return;
  }

  appIsQuitting = true;
  if (!quitCleanupStarted) {
    quitCleanupStarted = true;
    destroyDesktopPetWindow();
    destroyTray();
    stopVoiceInputHotkey();
    globalShortcut.unregisterAll();
    stopAllPowerSaveBlockers();
    stopCronDisplayWakeBlocker();
    stopAllTerminals();
    stopTunnelStatusPolling();
    stopAutoUpdater();
  }

  if (quitCleanupComplete) return;

  event.preventDefault();
  if (!quitCleanupPromise) {
    quitCleanupPromise = stopGatewayProcessAndWait().finally(() => {
      quitCleanupComplete = true;
      app.quit();
    });
  }
});

app.on('window-all-closed', () => {
  if (!shouldKeepAppInBackground()) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

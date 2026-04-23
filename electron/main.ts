import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserWindow, app, dialog, ipcMain, session, shell } from 'electron';

import { ensureGatewayConfigForElectron, getElectronUserPaths } from './ensure-gateway-config.js';
import {
  isCliBundlePresent,
  spawnGatewayProcess,
  stopGatewayProcess,
  waitForGatewayReady,
  type GatewayProcessOptions,
} from './gateway-process.js';
import { registerAgentIpc } from './ipc/agent-ipc.js';
import { registerFileIpc } from './ipc/file-ipc.js';
import { registerSearchIpc } from './ipc/search-ipc.js';
import { initElectronShellPreferences, registerSystemSettingsIpc, stopAllPowerSaveBlockers } from './ipc/system-settings-ipc.js';
import { registerUpdaterIpc } from './ipc/updater-ipc.js';
import { getLoadingPageDataUrl } from './loading-page.js';
import { initAutoUpdater, stopAutoUpdater } from './auto-updater.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Track the main window for gateway exit notifications. */
let mainWindow: BrowserWindow | null = null;

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
    const { port, token } = await ensureGatewayConfigForElectron(paths);
    try {
      const spawnOpts: GatewayProcessOptions = {
        configPath: paths.configPath,
        workspacePath: paths.workspacePath,
        port,
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

function createWindow(): void {
  if (mainWindow) {
    mainWindow.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(!app.isPackaged && existsSync(devWindowIcon) ? { icon: devWindowIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;

  initAutoUpdater(win);

  attachExternalUrlHandlers(win);

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
  // getUserMedia / MediaRecorder need Chromium "media" permission; without a handler some Electron
  // builds deny it for packaged apps (browser tabs are unaffected).
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  await initElectronShellPreferences();
  registerFileIpc(ipcMain);
  registerSearchIpc(ipcMain);
  registerAgentIpc(ipcMain);
  registerSystemSettingsIpc(ipcMain);
  registerUpdaterIpc(ipcMain);
  createWindow();
});

app.on('before-quit', () => {
  stopAllPowerSaveBlockers();
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

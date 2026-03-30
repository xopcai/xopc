import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserWindow, app, dialog, ipcMain } from 'electron';

import { ensureGatewayConfigForElectron, getElectronUserPaths } from './ensure-gateway-config.js';
import {
  isCliBundlePresent,
  spawnGatewayProcess,
  stopGatewayProcess,
  waitForGatewayHealth,
} from './gateway-process.js';
import { registerAgentIpc } from './ipc/agent-ipc.js';
import { registerFileIpc } from './ipc/file-ipc.js';
import { registerSearchIpc } from './ipc/search-ipc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Dev / unpackaged: window icon (Linux/Windows). Packaged apps use the bundle icon from electron-builder. */
const devWindowIcon = join(__dirname, '../../electron/resources/icon.png');

function shouldEmbedGateway(): boolean {
  if (process.env['ELECTRON_RENDERER_URL']) return false;
  const force = process.env['ELECTRON_EMBED_GATEWAY'] === '1';
  return (app.isPackaged || force) && isCliBundlePresent();
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
      spawnGatewayProcess({
        configPath: paths.configPath,
        workspacePath: paths.workspacePath,
        port,
      });
      await waitForGatewayHealth(port);
    } catch (e) {
      stopGatewayProcess();
      const msg = e instanceof Error ? e.message : String(e);
      void dialog.showErrorBox(
        'xopcbot',
        `Failed to start gateway.\n\n${msg}\n\nEnsure the app was built with: pnpm run build && pnpm run electron:vite:build`,
      );
      app.quit();
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
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(!app.isPackaged && existsSync(devWindowIcon) ? { icon: devWindowIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void (async () => {
    try {
      const load = await resolveWindowLoad();
      if (load.kind === 'url') {
        void win.loadURL(load.href);
        if (load.openDevTools) {
          win.webContents.openDevTools({ mode: 'detach' });
        }
      } else {
        void win.loadFile(load.path);
      }
    } catch {
      app.quit();
    }
  })();
}

app.whenReady().then(() => {
  registerFileIpc(ipcMain);
  registerSearchIpc(ipcMain);
  registerAgentIpc(ipcMain);
  createWindow();
});

app.on('before-quit', () => {
  stopGatewayProcess();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

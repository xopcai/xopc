import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { app, BrowserWindow, ipcMain, Menu, safeStorage, session } from 'electron';

import { RemoteChatStateStore } from '../chat/state.js';
import { RemoteShellWindow } from '../shell/window.js';

import { GatewayConnectionPreview } from './connection-manager.js';
import { ConnectionCredentialStore } from './credentials.js';
import { ConnectionProfileStore } from './profiles.js';
import { ConnectionWindowPolicy, installConnectionIpcBoundary } from './restricted-ipc.js';

export async function startGatewayConnectionPreview(entryUrl: string): Promise<void> {
  const assetRoot = join(dirname(fileURLToPath(entryUrl)), '../preload');
  const override = process.env['XOPC_ELECTRON_USER_DATA_DIR'];
  if (override) {
    const directory = resolve(override);
    mkdirSync(directory, { recursive: true });
    app.setPath('userData', directory);
  }
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  const policy = new ConnectionWindowPolicy();
  let shell: RemoteShellWindow | undefined;
  installConnectionIpcBoundary(ipcMain, (event, channel) => channel.startsWith('shell:')
    ? shell ? shell.authorize(event, channel) : (() => { throw new Error('REMOTE_CAPABILITY_DISABLED'); })()
    : policy.authorize(event, channel));
  await app.whenReady();
  const root = join(app.getPath('userData'), 'gateway-connections-v1');
  const encryption = {
    available: async () => {
      const available = await safeStorage.isAsyncEncryptionAvailable();
      return available && (process.platform !== 'linux'
        || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend()));
    },
    encrypt: (value: string) => safeStorage.encryptStringAsync(value),
    decrypt: async (value: Buffer) => (await safeStorage.decryptStringAsync(value)).result,
  };
  const manager = new GatewayConnectionPreview(new ConnectionProfileStore(root), new ConnectionCredentialStore(join(root, 'credentials'), encryption));
  const chatState = new RemoteChatStateStore(join(root, 'chat-state'), encryption);
  await manager.initialize();
  const isolated = session.fromPartition('gateway-connection-preview');
  isolated.setPermissionCheckHandler(() => false);
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.on('will-download', event => event.preventDefault());
  const documentPath = join(assetRoot, 'gateway-connections.html');
  const documentUrl = pathToFileURL(documentPath).href;
  const window = new BrowserWindow({ width: 780, height: 720, minWidth: 560, minHeight: 540,
    title: 'xopc · Gateway connections (S1 preview)',
    webPreferences: { preload: join(assetRoot, 'connections.cjs'), session: isolated,
      contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, navigateOnDragDrop: false } });
  policy.register(window.webContents, documentUrl);
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'xopc', submenu: [{ role: 'quit' }] }]));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => event.preventDefault());
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace && window.webContents.getURL() === documentUrl) policy.revoke();
  });
  window.webContents.on('render-process-gone', () => policy.revoke());
  window.on('closed', () => { policy.revoke(); void shell?.close().then(() => app.quit(), () => app.quit()); });
  app.on('second-instance', () => { if (!window.isDestroyed()) { window.show(); window.focus(); } });
  shell = new RemoteShellWindow(dirname(fileURLToPath(entryUrl)), assetRoot, manager, () => { if (!window.isDestroyed()) { window.show(); window.focus(); } }, chatState);
  let operations = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => { const next = operations.then(work); operations = next.then(() => {}, () => {}); return next; };
  const atEpoch = <T>(epoch: unknown, work: () => Promise<T>) => serialize(() => {
    if (epoch !== manager.snapshot().epoch) throw new Error('STALE_CONNECTION_EPOCH');
    return work();
  });
  const reply = async (work: () => unknown) => {
    try { return { ok: true, snapshot: await work() }; }
    catch (error) {
      const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'CONNECTION_STORAGE_FAILED';
      return { ok: false, error: code, snapshot: manager.snapshot() };
    }
  };
  ipcMain.handle('connections:snapshot', () => manager.snapshot());
  ipcMain.handle('connections:save', (_event, epoch, input) => {
    if (Buffer.byteLength(JSON.stringify(input) ?? '') > 16 * 1024) return { ok: false, error: 'CONNECTION_REQUEST_TOO_LARGE' };
    return reply(() => atEpoch(epoch, async () => { await shell!.close(); const result = await manager.save(epoch, input); await chatState.prune(result.profiles); return result; }));
  });
  ipcMain.handle('connections:select', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => { await shell!.close(); return manager.select(epoch, id); })));
  ipcMain.handle('connections:remove', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => { await shell!.close(); const result = await manager.remove(epoch, id); await chatState.prune(result.profiles); return result; })));
  ipcMain.handle('connections:connect', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => { await shell!.connect(epoch, id); return manager.snapshot(); })));
  ipcMain.handle('shell:bootstrap', event => serialize(() => { shell!.authorize(event, 'shell:bootstrap'); return shell!.bootstrap(); }));
  ipcMain.handle('shell:recover', event => serialize(async () => { shell!.authorize(event, 'shell:recover'); await shell!.close(); window.show(); window.focus(); return { ok: true }; }));
  ipcMain.handle('shell:state-read', event => serialize(() => { shell!.authorize(event, 'shell:state-read'); return shell!.readState(); }));
  ipcMain.handle('shell:state-write', (event, value) => {
    if (Buffer.byteLength(JSON.stringify(value) ?? '') > 256 * 1024) throw new Error('CHAT_STATE_TOO_LARGE');
    return serialize(() => { shell!.authorize(event, 'shell:state-write'); return shell!.writeState(value); });
  });
  ipcMain.handle('connections:quit', () => { app.quit(); });
  ipcMain.handle('connections:local', () => reply(() => serialize(async () => {
    await shell!.close();
    policy.revoke();
    app.relaunch({ args: process.defaultApp ? [process.argv[1]!] : [] });
    app.quit();
  })));
  // No local main import, Gateway initialization, Host, Web UI, or upstream request in S1.
  await window.loadURL(documentUrl);
}

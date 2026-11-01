import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { release } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, powerMonitor, safeStorage, session } from 'electron';

import { DesktopEnrollmentManager, type DesktopEnrollmentAction } from '../desktop/enrollment.js';
import { DesktopIdentityStore } from '../desktop/device-identity.js';
import { DesktopExecutionManager } from '../desktop/execution-manager.js';
import { DesktopExecutionCatalog } from '../desktop/execution-catalog.js';
import { DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR, desktopClipboardWorker } from '../desktop/clipboard-tool.js';
import { resolveStateDir } from '../../src/config/paths-state.js';
import { DesktopObservationManager } from '../desktop/observation-manager.js';
import { selectDesktopScreenSession } from '../desktop/screen-session.js';
import { installDesktopSessionBoundary } from '../desktop/session-boundary.js';
import { RemoteChatStateStore } from '../chat/state.js';
import { RemoteShellWindow } from '../shell/window.js';

import { GatewayConnectionPreview } from './connection-manager.js';
import { ConnectionCredentialStore } from './credentials.js';
import { ConnectionProfileStore } from './profiles.js';
import { ConnectionWindowPolicy, installConnectionIpcBoundary } from './restricted-ipc.js';
import { RemoteWindowPresentation } from './window-presentation.js';

export async function startGatewayConnectionPreview(entryUrl: string): Promise<void> {
  const presentation = new RemoteWindowPresentation(process.argv.includes('--gateway-connections-background'));
  // Remote file documents are explicitly unpacked; keep their resolver out of the local entry graph.
  const assetRoot = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked', 'out', 'preload')
    : join(dirname(fileURLToPath(entryUrl)), '../preload');
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
    show: presentation.showInitially, paintWhenInitiallyHidden: presentation.showInitially,
    title: 'xopc · Gateway connections (S1 preview)',
    webPreferences: { preload: join(assetRoot, 'connections.cjs'), session: isolated,
      contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, navigateOnDragDrop: false } });
  const desktopStore = new DesktopIdentityStore(join(root, 'desktop-identities'), encryption);
  const visible = () => !window.isDestroyed() && window.isVisible() && !window.isMinimized()
    && window.webContents.getURL() === documentUrl && window.webContents.mainFrame.url === documentUrl;
  const observation = new DesktopObservationManager({ manager, store: desktopStore, visible, appVersion: app.getVersion(),
    selectScreen: (binding, signal) => visible() ? selectDesktopScreenSession({ binding, signal, assets: assetRoot, parent: window, chat: shell?.captureWindow() }) : Promise.resolve(undefined),
    readState: async () => ({ platform: process.platform, systemVersion: release(), locale: app.getLocale(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    consent: async (binding, signal) => {
      if (!visible() || signal.aborted) return false;
      const result = await dialog.showMessageBox(window, { type: 'question', title: '授权只读设备状态',
        message: '允许此Gateway读取本机设备状态？',
        detail: `Gateway：${binding.origin}\n身份：${binding.gatewayId}\n\n仅提供平台、系统版本、语言、时区和采样时间。授权在本次连接内有效；不会读取屏幕、文件、剪贴板或执行命令。`,
        buttons: ['取消', '允许读取设备状态'], defaultId: 0, cancelId: 0, noLink: true, signal });
      return result.response === 1 && !signal.aborted && visible();
    },
  });
  const foreground = () => {
    const chat = shell?.captureWindow();
    return visible() && window.isFocused() || Boolean(chat && chat.isVisible() && !chat.isMinimized() && chat.isFocused());
  };
  const execution = new DesktopExecutionManager({ manager, store: desktopStore, executorRoot: join(resolveStateDir(), 'desktop-execution-v1'),
    appVersion: app.getVersion(), catalog: new DesktopExecutionCatalog([DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR]), foreground,
    createWorker: tool => { if (tool !== DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR.name) throw new Error('DESKTOP_EXECUTION_DENIED'); return desktopClipboardWorker(clipboard); },
    consent: async (binding, _grant, signal) => {
      if (!visible() || !window.isFocused() || signal.aborted) return false;
      const result = await dialog.showMessageBox(window, { type: 'question', title: '授权本机剪贴板写入',
        message: '允许此 Gateway 请求写入本机剪贴板？',
        detail: `Gateway：${binding.origin}\n身份：${binding.gatewayId}\n\n授权最长两分钟，仅允许写入不超过4000字符的文本；每次仍需本机确认。不会读取现有剪贴板、文件或执行命令。断线、锁屏、切换连接后需重新授权。`,
        buttons: ['取消', '允许逐次确认写入'], defaultId: 0, cancelId: 0, noLink: true, signal });
      return result.response === 1 && !signal.aborted && visible();
    },
    confirm: async (request, signal) => {
      const profile = manager.snapshot().profiles.find(profile => profile.id === manager.snapshot().selectedId);
      const parent = shell?.captureWindow() ?? window;
      if (profile?.identity?.gatewayId !== request.execution.gatewayId || !foreground() || signal.aborted || parent.isDestroyed()) return false;
      const result = await dialog.showMessageBox(parent, { type: 'question', title: '确认本次剪贴板写入',
        message: '将以下文本写入本机剪贴板？',
        detail: `Gateway：${profile.origin}\n设备：${request.execution.deviceId}\n操作：${request.execution.operationId}\n\n${JSON.stringify(request.arguments.text)}\n\n仅本次有效。现有剪贴板内容将被替换。`,
        buttons: ['取消', '写入本次文本'], defaultId: 0, cancelId: 0, noLink: true, signal });
      return result.response === 1 && !signal.aborted && foreground();
    },
  });
  const stopObservation = () => { observation.stop(); void shell?.setHostOrigin().catch(() => {}); };
  const stopCapabilities = () => { stopObservation(); void execution.stop(); };
  const cancelDesktop = () => { stopCapabilities(); desktop.cancel(); };
  const removeSessionBoundary = installDesktopSessionBoundary(powerMonitor, cancelDesktop);
  window.once('closed', removeSessionBoundary);
  const desktop = new DesktopEnrollmentManager({ manager, store: desktopStore, visible,
    consent: async (binding, signal, reenroll) => {
      if (window.isDestroyed() || !window.isVisible() || window.isMinimized() || signal.aborted) return false;
      const answer = await dialog.showMessageBox(window, {
        type: 'question', title: reenroll ? '重新登记电脑身份' : '登记电脑身份',
        message: reenroll ? '是否为这台电脑建立新的登记？' : '是否向此Gateway登记这台电脑？',
        detail: `Gateway：${binding.origin}\n身份：${binding.gatewayId}\n\n登记只用于确认电脑身份。屏幕、文件和命令等能力需要另行授权。`,
        buttons: ['取消', reenroll ? '重新登记' : '登记此电脑'], defaultId: 0, cancelId: 0, noLink: true, signal,
      });
      return answer.response === 1 && !signal.aborted && !window.isDestroyed() && window.isVisible() && !window.isMinimized()
        && window.webContents.getURL() === documentUrl && window.webContents.mainFrame.url === documentUrl;
    },
  });
  policy.register(window.webContents, documentUrl);
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'xopc', submenu: [{ label: '立即停止本机执行', click: () => { stopCapabilities(); } }, { role: 'quit' }] }]));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => event.preventDefault());
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace && window.webContents.getURL() === documentUrl) { cancelDesktop(); policy.revoke(); }
  });
  window.webContents.on('did-navigate-in-page', (_event, url, mainFrame) => {
    if (mainFrame && url !== documentUrl) { cancelDesktop(); policy.revoke(); }
  });
  window.webContents.on('render-process-gone', () => { cancelDesktop(); policy.revoke(); });
  window.on('closed', () => { cancelDesktop(); policy.revoke(); void shell?.close().then(() => app.quit(), () => app.quit()); });
  app.on('second-instance', () => presentation.reveal(window, true));
  shell = new RemoteShellWindow(dirname(fileURLToPath(entryUrl)), assetRoot, manager, () => { stopCapabilities(); presentation.reveal(window); }, chatState, presentation);
  const snapshot = () => ({ ...manager.snapshot(), localCapabilities: Boolean(execution.origin() || observation.origin()), desktop: desktop.snapshot(), observation: observation.snapshot(), execution: execution.snapshot(), presentation: {
    connectionVisible: window.isVisible(), connectionFocused: window.isFocused(), chat: shell!.presentationState(),
  } });
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
      return { ok: false, error: code, snapshot: window.isDestroyed() ? manager.snapshot() : snapshot() };
    }
  };
  ipcMain.handle('connections:snapshot', snapshot);
  ipcMain.handle('connections:save', (_event, epoch, input) => {
    if (Buffer.byteLength(JSON.stringify(input) ?? '') > 16 * 1024) return { ok: false, error: 'CONNECTION_REQUEST_TOO_LARGE' };
    return reply(() => atEpoch(epoch, async () => { cancelDesktop(); await execution.requireStopped(); await shell!.close(); const result = await manager.save(epoch, input); await chatState.prune(result.profiles); return snapshot(); }));
  });
  ipcMain.handle('connections:select', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => { cancelDesktop(); await execution.requireStopped(); await shell!.close(); await manager.select(epoch, id); return snapshot(); })));
  ipcMain.handle('connections:remove', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => { cancelDesktop(); await execution.requireStopped(); await shell!.close(); const result = await manager.remove(epoch, id); await chatState.prune(result.profiles); return snapshot(); })));
  ipcMain.handle('connections:connect', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => { cancelDesktop(); await execution.requireStopped(); await shell!.connect(epoch, id); return snapshot(); })));
  ipcMain.handle('shell:bootstrap', event => serialize(() => { shell!.authorize(event, 'shell:bootstrap'); return shell!.bootstrap(); }));
  ipcMain.handle('shell:recover', event => serialize(async () => { shell!.authorize(event, 'shell:recover'); stopCapabilities(); await execution.requireStopped(); await shell!.close(); presentation.reveal(window); return { ok: true }; }));
  ipcMain.handle('shell:host-settings', event => { shell!.authorize(event, 'shell:host-settings'); presentation.reveal(window); return { ok: true }; });
  ipcMain.handle('shell:host-origin', async event => {
    shell!.authorize(event, 'shell:host-origin'); const origin = await execution.readyOrigin() ?? await observation.readyOrigin();
    await shell!.setHostOrigin(origin);
    if (JSON.stringify(origin) !== JSON.stringify(execution.origin() ?? observation.origin())) { await shell!.setHostOrigin(); return; }
    return origin;
  });
  ipcMain.handle('shell:host-stop', event => { shell!.authorize(event, 'shell:host-stop'); stopCapabilities(); return { ok: true }; });
  ipcMain.handle('shell:state-read', event => serialize(() => { shell!.authorize(event, 'shell:state-read'); return shell!.readState(); }));
  ipcMain.handle('shell:state-write', (event, value) => {
    if (Buffer.byteLength(JSON.stringify(value) ?? '') > 256 * 1024) throw new Error('CHAT_STATE_TOO_LARGE');
    return serialize(() => { shell!.authorize(event, 'shell:state-write'); return shell!.writeState(value); });
  });
  for (const action of ['enroll', 'check', 'disable', 'reenroll'] as DesktopEnrollmentAction[]) {
    ipcMain.handle(`connections:desktop-${action}`, (_event, epoch, id) => reply(async () => {
      if (epoch !== manager.snapshot().epoch) throw new Error('STALE_CONNECTION_EPOCH');
      if (action !== 'check') { stopCapabilities(); await execution.requireStopped(); }
      try { await desktop.perform(action, epoch, id); }
      catch (error) { if (error instanceof Error && error.message === 'DESKTOP_AUTH_REVOKED') stopCapabilities(); throw error; }
      return snapshot();
    }));
  }
  ipcMain.handle('connections:observation-start', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => { if (id !== manager.snapshot().selectedId) throw new Error('STALE_CONNECTION_EPOCH'); await execution.requireStopped(); await observation.start(epoch, id); return snapshot(); })));
  ipcMain.handle('connections:screen-start', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => { if (id !== manager.snapshot().selectedId) throw new Error('STALE_CONNECTION_EPOCH'); await execution.requireStopped(); await observation.start(epoch, id, 'screen'); return snapshot(); })));
  ipcMain.handle('connections:observation-stop', () => { stopObservation(); return { ok: true, snapshot: snapshot() }; });
  ipcMain.handle('connections:execution-start', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => { if (id !== manager.snapshot().selectedId) throw new Error('STALE_CONNECTION_EPOCH'); stopObservation(); await observation.whenStopped(); await execution.start(epoch, id); return snapshot(); })));
  ipcMain.handle('connections:execution-stop', () => reply(async () => { await execution.stop(); return snapshot(); }));
  ipcMain.handle('connections:quit', () => { cancelDesktop(); app.quit(); });
  ipcMain.handle('connections:local', () => { cancelDesktop(); return reply(() => serialize(async () => {
    await execution.requireStopped();
    await shell!.close();
    policy.revoke();
    app.relaunch({ args: process.defaultApp ? [process.argv[1]!] : [] });
    app.quit();
  })); });
  let exiting = false;
  const finishExit = async (close: () => void) => {
    cancelDesktop();
    try { await execution.requireStopped(); exiting = true; close(); }
    catch { if (!window.isDestroyed()) presentation.reveal(window); }
  };
  window.on('close', event => { if (!exiting) { event.preventDefault(); void finishExit(() => window.close()); } });
  app.on('before-quit', event => { if (!exiting) { event.preventDefault(); void finishExit(() => app.quit()); } });
  // No local Gateway, executor or upstream request is started by opening this document.
  await window.loadURL(documentUrl);
}

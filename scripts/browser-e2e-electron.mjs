// Native Electron acceptance host: actual production preload/IPC, current UI and real isolated Gateway.
import { app, BrowserWindow, contentTracing, ipcMain, Menu, shell } from 'electron';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { registerBrowserIpc } from '../electron/browser/browser-host.ts';
import { registerFileIpc } from '../electron/ipc/file-ipc.ts';
import { registerTerminalIpc, stopAllTerminals } from '../electron/ipc/terminal-ipc.ts';
import { registerGatewayConnection } from '../electron/gateway-process.ts';

const fixture = JSON.parse(readFileSync('/tmp/xopc-workspace-e2e.json', 'utf8'));
const root = resolve(process.cwd());
app.setName('XOPC Workspace Acceptance');
app.commandLine.appendSwitch('force-renderer-accessibility');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'xopc-browser-electron-')));
app.whenReady().then(async () => {
const window = new BrowserWindow({ title: 'XOPC Browser E2E', width: 1440, height: 940, webPreferences: { preload: join(root, 'out/preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
let tracing = false;
Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'Acceptance', submenu: [
    { label: 'Start transition trace', click: async () => {
      if (tracing) return;
      await contentTracing.startRecording({ included_categories: ['devtools.timeline', 'blink.user_timing', 'cc', 'toplevel', 'benchmark'], recording_mode: 'record-continuously', trace_buffer_size_in_kb: 32768 });
      tracing = true;
      console.log('Transition trace started');
    } },
    { label: 'Save transition trace', click: async () => {
      if (!tracing) return;
      console.log('Transition trace saved:', await contentTracing.stopRecording('/tmp/xopc-workspace-transition-trace.json'));
      tracing = false;
    } },
    { type: 'separator' },
    { label: 'Desktop size', click: () => window.setSize(1440, 940) },
    { label: 'Compact size', click: () => window.setSize(720, 900) },
    { label: 'Narrow size', click: () => window.setSize(375, 812) },
    { label: 'Crash active browser', click: () => {
      const guest = window.contentView.children.find(view => view.webContents && view.webContents !== window.webContents);
      guest?.webContents.forcefullyCrashRenderer();
    } },
    { type: 'separator' }, { role: 'quit' },
  ] }, { role: 'editMenu' },
]));
registerBrowserIpc(ipcMain, () => window);
registerFileIpc(ipcMain, { allowedRoots: [fixture.workspace] });
registerGatewayConnection({ port: Number(new URL(fixture.base).port), token: fixture.token });
registerTerminalIpc(ipcMain);
window.webContents.on('page-title-updated', event => { event.preventDefault(); window.setTitle('XOPC Workspace Acceptance'); });
window.webContents.on('console-message', (_event, ...details) => console.log('Renderer:', ...details));
window.webContents.on('render-process-gone', (_event, details) => console.error('Renderer gone:', details));
ipcMain.handle('gateway:get-credential', () => fixture.token);
ipcMain.handle('shell:open-external-url', (_event, url) => shell.openExternal(url));
// Unrelated OS control and updater services are disabled in the isolated acceptance host.
ipcMain.handle('electron-theme:get', () => 'light');
ipcMain.handle('electron-theme:set', (_event, theme) => ({ ok: true, theme }));
ipcMain.handle('electron-locale:get', () => 'en');
ipcMain.handle('electron-locale:set', (_event, language) => ({ ok: true, language }));
ipcMain.handle('updater:get-status', () => ({ state: 'idle' }));
ipcMain.handle('system-settings:get-behavior', () => ({ platform: 'darwin', packaged: false, runInBackground: false, backgroundSupported: false, openAtLogin: false, openAsHidden: false, keepAwakeEnabled: false, keepAwakePreferred: false, notifyEnabled: false, notifySoundEnabled: false }));
ipcMain.handle('understanding-sources:catalog', () => []);
ipcMain.handle('computer:status', () => ({ connected: false, permissions: { accessibility: false, screenRecording: 'unknown' } }));
window.on('closed', () => { stopAllTerminals(); app.quit(); });
app.on('before-quit', stopAllTerminals);
await window.loadURL(fixture.url);
console.log('Native acceptance window ready');

});

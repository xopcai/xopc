/** Bundle into out/main/ and launch with Electron to exercise the production pet window. */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { app, BrowserWindow, ipcMain, Menu, type IpcMain } from 'electron';

import { registerDesktopPetIpc } from '../electron/desktop-pet/ipc.js';
import { patchDesktopPetPrefs } from '../electron/desktop-pet/prefs.js';
import {
  acknowledgeDesktopPetEvent,
  applyDesktopPetPrefs,
  destroyDesktopPetWindow,
  dragDesktopPet,
  endDesktopPetDrag,
  getDesktopPetState,
  initDesktopPetWindow,
  sendDesktopPetEvent,
  showDesktopPet,
  startDesktopPetDrag,
} from '../electron/desktop-pet/window.js';
import type { PetSessionUpdate } from '../electron/desktop-pet/types.js';

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'xopc-native-pet-'));
  process.env.XOPC_STATE_DIR = directory;
  app.setPath('userData', directory);
  app.setName('Loopi Native Validation');
  await app.whenReady();
  registerDesktopPetIpc({
    handle: (channel, handler) => ipcMain.handle(channel, (...args) => {
      if (channel.startsWith('desktop-pet:drag-')) console.info('DRAG_IPC', channel, args[1]);
      return handler(...args);
    }),
  } as IpcMain);
  // Standalone shell services; pet IPC and window handling remain production code.
  ipcMain.handle('electron-locale:get', () => 'zh');
  ipcMain.handle('electron-locale:set', (_event, language) => ({ ok: true, language }));
  ipcMain.handle('electron-theme:get', () => 'light');
  ipcMain.handle('electron-theme:set', (_event, theme) => ({ ok: true, theme }));
  ipcMain.handle('gateway:get-credential', () => undefined);
  let messageDestination: BrowserWindow | undefined;
  initDesktopPetWindow({
    resolveUrl: () => `${process.env.XOPC_PET_RENDERER_URL ?? 'http://127.0.0.1:5179/'}#/desktop-pet`,
    openMainWindow: (path) => {
      console.info('OPEN_MAIN_WINDOW', path);
      if (!messageDestination || messageDestination.isDestroyed()) {
        messageDestination = new BrowserWindow({ width: 640, height: 360, show: false, title: 'Pet message destination' });
        void messageDestination.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<h1>会话已打开</h1><p>本窗口用于验证点击消息后，主窗口获得焦点、宠物继续显示。</p>')}`).then(() => {
          messageDestination!.show();
          messageDestination!.focus();
          void getDesktopPetState().then((state) => console.info('MESSAGE_OPENED', { petVisible: state.visible, petBounds: window.getBounds() }));
        });
      } else {
        messageDestination.show();
        messageDestination.focus();
      }
    },
    disableSandbox: false,
  });
  await patchDesktopPetPrefs({
    enabled: true, selectedPetId: 'loopi', sizePercent: 140,
    proactiveTipsEnabled: false, behaviorMode: 'playful',
    anchor: { x: 900, y: 650 },
  });
  await showDesktopPet();
  const window = BrowserWindow.getAllWindows()[0];
  window.setTitle('Loopi Native Validation');
  window.show();
  window.focus();
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') console.info('RENDERER', event.message);
  });
  window.webContents.on('render-process-gone', (_event, details) => console.error('RENDERER_GONE', details.reason));
  window.on('moved', () => console.info('MOVED', window.getBounds()));
  let sequence = 0;
  const conversationId = 'pet-native-validation';
  const runId = `native-${Date.now()}`;
  async function state(name: 'idle' | 'work' | 'wait' | 'done') {
    if (name === 'idle') {
      acknowledgeDesktopPetEvent(conversationId, runId);
      await patchDesktopPetPrefs({ proactiveTipsEnabled: false });
      await showDesktopPet();
      window.webContents.reload();
    } else {
      const update: PetSessionUpdate = {
        conversationId, runId, sessionLabel: '原生悬浮窗验证', sequence: ++sequence,
        timestamp: Date.now(), state: name === 'work' ? 'running' : name === 'wait' ? 'waiting' : 'success',
        phase: name === 'work' ? 'running' : 'waiting',
        animation: name === 'work' ? 'execute' : name === 'wait' ? 'wait' : 'success',
        action: name === 'work' ? '正在整理验证方案' : name === 'wait' ? '等待你的确认' : '验证任务已完成',
        publicSummary: '原生窗口本地测试事件',
      };
      await sendDesktopPetEvent(update);
    }
    window.focus();
    console.info('STATE', name, 'BOUNDS', window.getBounds());
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Loopi', submenu: [{ role: 'quit' }] },
    { label: '验证', submenu: [
      ...(['idle', 'work', 'wait', 'done'] as const).map((name, index) => ({
        label: name, accelerator: `CommandOrControl+${index + 1}`, click: () => void state(name),
      })),
      { label: '状态与位置', accelerator: 'CommandOrControl+5', click: () => void getDesktopPetState().then((state) => console.info('POSITION', state.prefs.anchor, window.getBounds())) },
      ...([70, 100, 140] as const).map((sizePercent, index) => ({
        label: `尺寸 ${sizePercent}%`, accelerator: `CommandOrControl+${index + 6}`,
        click: () => void applyDesktopPetPrefs({ sizePercent }),
      })),
      { label: '测试左上边界', accelerator: 'CommandOrControl+9', click: () => {
        startDesktopPetDrag({ screenX: 0, screenY: 0 });
        dragDesktopPet({ screenX: -10000, screenY: -10000 });
        void endDesktopPetDrag().then(() => console.info('EDGE_BOUNDS', window.getBounds()));
      } },
    ] },
  ]));
  console.info('NATIVE_PET_READY', { directory, mediaSourceId: window.getMediaSourceId(), bounds: window.getBounds() });
  app.on('before-quit', destroyDesktopPetWindow);
  app.on('window-all-closed', () => app.quit());

}

void main().catch((error) => { console.error(error); app.quit(); });

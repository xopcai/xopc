import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { app, dialog, globalShortcut, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import { writeTextAtomicSync } from '../src/infra/write-file-atomic.js';

import { captureDesktopScreenshot } from './desktop-screenshot.js';
import { getElectronShellLanguage } from './ipc/system-settings-ipc.js';

const MODIFIERS = { meta: 'Command', control: 'Control', alt: 'Alt', shift: 'Shift' } as const;
type Modifier = keyof typeof MODIFIERS;

function parseShortcut(value: unknown, platform: NodeJS.Platform) {
  if (typeof value !== 'string') return;
  const parts = value.split('+');
  const key = parts.pop() ?? '';
  const modifiers = Object.keys(MODIFIERS).filter((modifier) => parts.includes(modifier)) as Modifier[];
  if (!modifiers.length || modifiers.length !== parts.length || modifiers.every((modifier) => modifier === 'shift')
    || !/^(?:[a-z0-9.,/;='\[\]\\`-]|space|f(?:[1-9]|1[0-9]|20))$/.test(key)) return;

  return {
    shortcut: [...modifiers, key].join('+'),
    accelerator: [...modifiers.map((modifier) => modifier === 'meta' && platform !== 'darwin' ? 'Super' : MODIFIERS[modifier]), key.toUpperCase()].join('+'),
  };
}

export function registerScreenshotShortcut(
  mainWindow: () => BrowserWindow | null,
  assertMainRenderer: (event: IpcMainInvokeEvent) => void,
  onTrigger?: () => Promise<unknown> | void,
): () => void {
  const platform = process.platform;
  if (platform !== 'darwin' && platform !== 'win32' && platform !== 'linux') return () => {};

  const defaultShortcut = platform === 'darwin' ? 'meta+control+a' : 'control+alt+a';
  const wayland = platform === 'linux'
    && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);

  const path = join(app.getPath('userData'), 'screenshot-shortcut.txt');
  let current = parseShortcut(defaultShortcut, platform)!;
  try {
    current = parseShortcut(readFileSync(path, 'utf8').trim(), platform) ?? current;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[Screenshot] Could not load shortcut', error);
    }
  }

  let registered = false;
  let recordingWindow: BrowserWindow | undefined;
  let capture: AbortController | undefined;
  const takeScreenshot = () => {
    if (capture || recordingWindow?.isFocused()) return;
    if (onTrigger) {
      void Promise.resolve(onTrigger()).catch((error) => {
        console.warn('[Screenshot] Custom screenshot handler failed', error);
      });
      return;
    }
    const controller = new AbortController();
    capture = controller;
    void captureDesktopScreenshot(controller.signal).catch((error) => {
      if (controller.signal.aborted) return;
      console.warn('[Screenshot] Could not capture screen', error);
      const chinese = getElectronShellLanguage() === 'zh';
      void dialog.showMessageBox({
        type: 'error',
        message: chinese ? '无法截图' : 'Could not capture the screen',
        detail: platform === 'linux'
          ? chinese
            ? '请检查桌面截图权限，或确认系统已安装截图服务。'
            : 'Check your desktop screenshot permissions and that a screenshot service is installed.'
          : undefined,
      }).catch(() => undefined);
    }).finally(() => { capture = undefined; });
  };

  const registerCurrent = () => {
    if (!registered) registered = globalShortcut.register(current.accelerator, takeScreenshot);
  };
  const stopRecording = () => {
    if (!recordingWindow) return;
    recordingWindow.removeListener('blur', stopRecording);
    recordingWindow.webContents.removeListener('did-start-loading', stopRecording);
    recordingWindow.webContents.removeListener('render-process-gone', stopRecording);
    recordingWindow.removeListener('close', stopRecording);
    recordingWindow = undefined;
    registerCurrent();
  };

  registerCurrent();

  const channels = { get: 'screenshot-shortcut:get', record: 'screenshot-shortcut:record', set: 'screenshot-shortcut:set' };
  ipcMain.handle(channels.get, (event) => {
    assertMainRenderer(event);
    return { shortcut: current.shortcut, defaultShortcut, registered };
  });
  ipcMain.handle(channels.record, (event, active: unknown) => {
    assertMainRenderer(event);
    if (active !== true) {
      stopRecording();
      return;
    }
    const window = mainWindow();
    if (!window?.isFocused() || recordingWindow) return;
    // Keep the Wayland portal binding while recording to avoid repeated consent prompts.
    if (registered && !wayland) {
      globalShortcut.unregister(current.accelerator);
      registered = false;
    }
    recordingWindow = window;
    window.once('blur', stopRecording);
    window.once('close', stopRecording);
    window.webContents.once('did-start-loading', stopRecording);
    window.webContents.once('render-process-gone', stopRecording);
  });
  ipcMain.handle(channels.set, (event, value: unknown) => {
    assertMainRenderer(event);
    const next = parseShortcut(value, platform);
    if (!next) return 'invalid';
    stopRecording();
    const sameBinding = registered && next.accelerator === current.accelerator;
    if (!sameBinding && !globalShortcut.register(next.accelerator, takeScreenshot)) return 'conflict';
    try {
      writeTextAtomicSync(path, next.shortcut + '\n', { mode: 0o600 });
    } catch (error) {
      if (!sameBinding) globalShortcut.unregister(next.accelerator);
      console.warn('[Screenshot] Could not save shortcut', error);
      return 'saveFailed';
    }
    if (registered && !sameBinding) globalShortcut.unregister(current.accelerator);
    current = next;
    registered = true;
    return 'ok';
  });

  return () => {
    stopRecording();
    if (registered) globalShortcut.unregister(current.accelerator);
    capture?.abort();
    for (const channel of Object.values(channels)) ipcMain.removeHandler(channel);
  };
}

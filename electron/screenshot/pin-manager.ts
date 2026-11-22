import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import {
  BrowserWindow,
  Menu,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';

import type { PinWindowPayload, ScreenshotLanguage, ScreenshotRect } from './types.js';

interface ManagedPin {
  id: string;
  window: BrowserWindow;
  pngBase64: string;
  baseWidth: number;
  baseHeight: number;
  scaleFactor: number;
  alwaysOnTop: boolean;
  opacity: number;
  dragOrigin?: {
    cursorX: number;
    cursorY: number;
    winX: number;
    winY: number;
  };
}

export interface PinActionHandlers {
  onCopy: (pngBase64: string) => void;
  onSave: (pngBase64: string, parent: BrowserWindow) => Promise<void>;
  onSendToChat: (pngBase64: string, width: number, height: number) => void;
  getLanguage: () => ScreenshotLanguage;
  disableSandbox?: boolean;
}

export class ScreenshotPinManager {
  private readonly pins = new Map<string, ManagedPin>();
  private ipcRegistered = false;

  constructor(private readonly handlers: PinActionHandlers) {}

  registerIpc(): void {
    if (this.ipcRegistered) return;
    this.ipcRegistered = true;

    const findSenderPin = (event: IpcMainEvent | IpcMainInvokeEvent, pinId: unknown): ManagedPin | null => {
      if (typeof pinId !== 'string') return null;
      const entry = this.pins.get(pinId);
      if (!entry || entry.window.isDestroyed() || entry.window.webContents !== event.sender) {
        return null;
      }
      return entry;
    };

    ipcMain.on('screenshot-pin:drag-start', (event, data: { pinId?: unknown; screenX?: unknown; screenY?: unknown }) => {
      const pin = findSenderPin(event, data?.pinId);
      if (!pin || typeof data.screenX !== 'number' || typeof data.screenY !== 'number') return;
      const bounds = pin.window.getBounds();
      pin.dragOrigin = {
        cursorX: data.screenX,
        cursorY: data.screenY,
        winX: bounds.x,
        winY: bounds.y,
      };
    });

    ipcMain.on('screenshot-pin:drag-move', (event, data: { pinId?: unknown; screenX?: unknown; screenY?: unknown }) => {
      const pin = findSenderPin(event, data?.pinId);
      if (!pin?.dragOrigin || typeof data.screenX !== 'number' || typeof data.screenY !== 'number') return;
      const nextX = Math.round(pin.dragOrigin.winX + (data.screenX - pin.dragOrigin.cursorX));
      const nextY = Math.round(pin.dragOrigin.winY + (data.screenY - pin.dragOrigin.cursorY));
      pin.window.setPosition(nextX, nextY, false);
    });

    ipcMain.on('screenshot-pin:drag-end', (event, data: { pinId?: unknown }) => {
      const pin = findSenderPin(event, data?.pinId);
      if (pin) pin.dragOrigin = undefined;
    });

    ipcMain.handle(
      'screenshot-pin:action',
      async (
        event,
        data: {
          pinId?: unknown;
          action?: unknown;
          alwaysOnTop?: unknown;
          opacity?: unknown;
          zoom?: unknown;
        },
      ) => {
        const pin = findSenderPin(event, data?.pinId);
        if (!pin || typeof data?.action !== 'string') return { ok: false };

        switch (data.action) {
          case 'close':
            pin.window.close();
            return { ok: true };
          case 'copy':
            this.handlers.onCopy(pin.pngBase64);
            return { ok: true };
          case 'save':
            await this.handlers.onSave(pin.pngBase64, pin.window);
            return { ok: true };
          case 'chat':
            this.handlers.onSendToChat(pin.pngBase64, pin.baseWidth, pin.baseHeight);
            return { ok: true };
          case 'set-always-on-top': {
            const next = Boolean(data.alwaysOnTop);
            pin.alwaysOnTop = next;
            pin.window.setAlwaysOnTop(next, 'floating');
            return { ok: true };
          }
          case 'set-opacity': {
            if (typeof data.opacity === 'number' && Number.isFinite(data.opacity)) {
              pin.opacity = Math.max(0.2, Math.min(1, data.opacity));
              pin.window.setOpacity(pin.opacity);
            }
            return { ok: true };
          }
          case 'set-zoom': {
            if (typeof data.zoom === 'number' && Number.isFinite(data.zoom)) {
              const minScale = Math.max(0.25, 48 / Math.max(1, Math.min(pin.baseWidth, pin.baseHeight)));
              const clamped = Math.max(minScale, Math.min(4, data.zoom));
              const bounds = pin.window.getBounds();
              const nextW = Math.max(48, Math.round(pin.baseWidth * clamped));
              const nextH = Math.max(48, Math.round(pin.baseHeight * clamped));
              const centerX = bounds.x + bounds.width / 2;
              const centerY = bounds.y + bounds.height / 2;
              pin.window.setBounds(
                {
                  x: Math.round(centerX - nextW / 2),
                  y: Math.round(centerY - nextH / 2),
                  width: nextW,
                  height: nextH,
                },
                false,
              );
            }
            return { ok: true };
          }
          case 'context-menu': {
            const zh = this.handlers.getLanguage() === 'zh';
            const menu = Menu.buildFromTemplate([
              {
                label: zh ? '复制图片' : 'Copy Image',
                click: () => this.handlers.onCopy(pin.pngBase64),
              },
              {
                label: zh ? '保存图片…' : 'Save Image…',
                click: () => {
                  void this.handlers.onSave(pin.pngBase64, pin.window);
                },
              },
              {
                label: zh ? '发送到对话' : 'Send to Chat',
                click: () => this.handlers.onSendToChat(pin.pngBase64, pin.baseWidth, pin.baseHeight),
              },
              { type: 'separator' },
              {
                label: zh ? '置顶窗口' : 'Always on Top',
                type: 'checkbox',
                checked: pin.alwaysOnTop,
                click: () => {
                  pin.alwaysOnTop = !pin.alwaysOnTop;
                  pin.window.setAlwaysOnTop(pin.alwaysOnTop, 'floating');
                },
              },
              {
                label: zh ? '透明度' : 'Opacity',
                submenu: [100, 80, 60, 40].map((pct) => ({
                  label: `${pct}%`,
                  type: 'radio' as const,
                  checked: Math.abs(Math.round(pin.opacity * 100) - pct) < 10,
                  click: () => {
                    pin.opacity = pct / 100;
                    pin.window.setOpacity(pin.opacity);
                  },
                })),
              },
              { type: 'separator' },
              {
                label: zh ? '关闭贴图' : 'Close Pin',
                click: () => pin.window.close(),
              },
            ]);
            menu.popup({ window: pin.window });
            return { ok: true };
          }
          default:
            return { ok: false };
        }
      },
    );
  }

  async createPin(options: {
    screenBounds: ScreenshotRect;
    pngBase64: string;
    scaleFactor: number;
  }): Promise<string> {
    this.registerIpc();
    const pinId = randomUUID();
    const width = Math.max(64, Math.round(options.screenBounds.width));
    const height = Math.max(48, Math.round(options.screenBounds.height));

    const win = new BrowserWindow({
      x: Math.round(options.screenBounds.x),
      y: Math.round(options.screenBounds.y),
      width,
      height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: true,
      alwaysOnTop: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/screenshot-pin.cjs'),
        partition: 'screenshot-pin-private',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: !this.handlers.disableSandbox,
      },
    });

    win.setAlwaysOnTop(true, 'floating');
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());

    const entry: ManagedPin = {
      id: pinId,
      window: win,
      pngBase64: options.pngBase64,
      baseWidth: width,
      baseHeight: height,
      scaleFactor: options.scaleFactor,
      alwaysOnTop: true,
      opacity: 1,
    };
    this.pins.set(pinId, entry);

    win.once('closed', () => {
      this.pins.delete(pinId);
    });

    await win.loadFile(join(import.meta.dirname, '../preload/screenshot-pin.html'));
    if (!win.isDestroyed()) {
      const payload: PinWindowPayload = {
        pinId,
        pngBase64: options.pngBase64,
        width,
        height,
        scaleFactor: options.scaleFactor,
        language: this.handlers.getLanguage(),
        alwaysOnTop: true,
        opacity: 1,
      };
      win.webContents.send('screenshot-pin:init', payload);
      win.show();
    }
    return pinId;
  }

  closeAll(): void {
    for (const entry of this.pins.values()) {
      if (!entry.window.isDestroyed()) {
        entry.window.destroy();
      }
    }
    this.pins.clear();
  }

  dispose(): void {
    this.closeAll();
    if (this.ipcRegistered) {
      this.ipcRegistered = false;
      ipcMain.removeAllListeners('screenshot-pin:drag-start');
      ipcMain.removeAllListeners('screenshot-pin:drag-move');
      ipcMain.removeAllListeners('screenshot-pin:drag-end');
      ipcMain.removeHandler('screenshot-pin:action');
    }
  }
}

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  BrowserWindow,
  ClipboardItem,
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';

import { writeTextAtomicSync } from '../../src/infra/write-file-atomic.js';
import { createLogger } from '../../src/utils/logger.js';
import { captureDesktopScreenshot } from '../desktop-screenshot.js';
import type { DesktopGatewayTarget } from '../gateway/desktop-transport.js';
import { getElectronShellLanguage } from '../ipc/system-settings-ipc.js';
import { loadPrivateRendererDocument } from '../private-renderer-document.js';

import {
  captureDesktopFrames,
  captureDisplayRegionRgba,
  isAutoScrollSupported,
  runPlatformLocalOcr,
  sendPlatformAutoScrollStep,
} from './capture-provider.js';
import { displayToScreenRect } from './geometry.js';
import { ScreenshotPinManager } from './pin-manager.js';
import { ScrollStitcher, type RgbaFrame } from './stitch.js';
import type {
  DisplayCaptureFrame,
  ScreenshotChatDelivery,
  ScreenshotHistoryItem,
  ScreenshotLanguage,
  ScreenshotOcrResponse,
  ScreenshotOverlayPayload,
  ScreenshotPreferences,
  ScreenshotRect,
  ScreenshotTranslateResponse,
  ScrollCaptureProgress,
} from './types.js';

const PREFS_FILE = 'screenshot-prefs.json';
const MAX_HISTORY = 10;
const log = createLogger('Screenshot');

interface ActiveOverlaySession {
  sessionId: string;
  controller: AbortController;
  overlays: Map<number, { window: BrowserWindow; frame: DisplayCaptureFrame; ready: boolean }>;
  claimedDisplayId?: number;
  restoredMainWindow: boolean;
  scrollState?: {
    displayId: number;
    rect: ScreenshotRect;
    stitcher: ScrollStitcher;
    timer?: ReturnType<typeof setInterval>;
    busy: boolean;
    autoScrolling: boolean;
    quietTicks: number;
  };
}

export function rgbaFrameToPngBuffer(frame: RgbaFrame): Buffer {
  const bgra = Buffer.allocUnsafe(frame.data.byteLength);
  for (let i = 0; i + 3 < frame.data.byteLength; i += 4) {
    bgra[i] = frame.data[i + 2]!;
    bgra[i + 1] = frame.data[i + 1]!;
    bgra[i + 2] = frame.data[i]!;
    bgra[i + 3] = frame.data[i + 3]!;
  }
  const img = nativeImage.createFromBitmap(bgra, {
    width: frame.width,
    height: frame.height,
  });
  return img.toPNG();
}

function timestampSlug(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export interface ScreenshotManagerDeps {
  getMainWindow: () => BrowserWindow | null;
  focusOrCreateMainWindow: () => void;
  getGatewayTarget: () => DesktopGatewayTarget | undefined;
  assertMainRenderer: (event: IpcMainInvokeEvent) => void;
  disableSandbox?: boolean;
}

export class ScreenshotManager {
  private active: ActiveOverlaySession | null = null;
  private capturing = false;
  private prefs: ScreenshotPreferences = { hideMainWindow: false };
  private prefsLoaded = false;
  private readonly history: ScreenshotHistoryItem[] = [];
  private readonly pendingDeliveries: ScreenshotChatDelivery[] = [];
  private readonly pinManager: ScreenshotPinManager;
  private ipcRegistered = false;

  constructor(private readonly deps: ScreenshotManagerDeps) {
    this.pinManager = new ScreenshotPinManager({
      onCopy: (pngBase64) => {
        void this.copyPngBase64ToClipboard(pngBase64);
      },
      onSave: async (pngBase64, parent) => {
        await this.savePngBase64ToDisk(pngBase64, parent);
      },
      onSendToChat: (pngBase64, width, height) => {
        this.deliverToRenderer({
          id: randomUUID(),
          createdAt: Date.now(),
          pngBase64,
          fileName: `screenshot-${timestampSlug()}.png`,
          width,
          height,
          targetMode: 'chat',
        });
      },
      getLanguage: () => this.language(),
      disableSandbox: deps.disableSandbox,
    });
  }

  private language(): ScreenshotLanguage {
    return getElectronShellLanguage() === 'zh' ? 'zh' : 'en';
  }

  private prefsPath(): string {
    return join(app.getPath('userData'), PREFS_FILE);
  }

  getPreferences(): ScreenshotPreferences {
    if (!this.prefsLoaded) {
      this.prefsLoaded = true;
      try {
        const raw = JSON.parse(readFileSync(this.prefsPath(), 'utf8')) as Partial<ScreenshotPreferences>;
        this.prefs = {
          hideMainWindow: typeof raw.hideMainWindow === 'boolean' ? raw.hideMainWindow : false,
        };
      } catch {
        this.prefs = { hideMainWindow: false };
      }
    }
    return { ...this.prefs };
  }

  setPreferences(patch: Partial<ScreenshotPreferences>): ScreenshotPreferences {
    const current = this.getPreferences();
    const next: ScreenshotPreferences = {
      hideMainWindow: typeof patch.hideMainWindow === 'boolean' ? patch.hideMainWindow : current.hideMainWindow,
    };
    this.prefs = next;
    try {
      writeTextAtomicSync(this.prefsPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    } catch (error) {
      console.warn('[Screenshot] Could not persist screenshot preferences', error);
    }
    return { ...next };
  }

  getHistory(): ScreenshotHistoryItem[] {
    return [...this.history];
  }

  takePendingDeliveries(): ScreenshotChatDelivery[] {
    const items = [...this.pendingDeliveries];
    this.pendingDeliveries.length = 0;
    return items;
  }

  registerIpc(): void {
    if (this.ipcRegistered) return;
    this.ipcRegistered = true;
    this.pinManager.registerIpc();

    // Main renderer IPC
    ipcMain.handle('screenshot:start', async (event, rawOptions: unknown) => {
      this.deps.assertMainRenderer(event);
      const hideWindow =
        rawOptions && typeof rawOptions === 'object' && 'hideWindow' in rawOptions
          ? Boolean((rawOptions as { hideWindow?: unknown }).hideWindow)
          : undefined;
      return this.startCapture({ hideMainWindowOverride: hideWindow });
    });

    ipcMain.handle('screenshot:get-prefs', (event) => {
      this.deps.assertMainRenderer(event);
      return this.getPreferences();
    });

    ipcMain.handle('screenshot:set-prefs', (event, patch: unknown) => {
      this.deps.assertMainRenderer(event);
      if (!patch || typeof patch !== 'object') return this.getPreferences();
      return this.setPreferences(patch as Partial<ScreenshotPreferences>);
    });

    ipcMain.handle('screenshot:get-history', (event) => {
      this.deps.assertMainRenderer(event);
      return this.getHistory();
    });

    ipcMain.handle('screenshot:take-pending-deliveries', (event) => {
      this.deps.assertMainRenderer(event);
      return this.takePendingDeliveries();
    });

    ipcMain.handle('screenshot:ack-delivery', (event, id: unknown) => {
      this.deps.assertMainRenderer(event);
      if (typeof id === 'string') {
        const idx = this.pendingDeliveries.findIndex((item) => item.id === id);
        if (idx >= 0) this.pendingDeliveries.splice(idx, 1);
      }
      return { ok: true };
    });

    // Overlay window IPC (strictly sender-verified against active overlay BrowserWindows)
    const verifyOverlaySender = (
      event: IpcMainEvent | IpcMainInvokeEvent,
      sessionId: unknown,
    ): ActiveOverlaySession | null => {
      if (!this.active || typeof sessionId !== 'string' || this.active.sessionId !== sessionId) {
        return null;
      }
      for (const entry of this.active.overlays.values()) {
        if (!entry.window.isDestroyed() && entry.window.webContents === event.sender) {
          return this.active;
        }
      }
      return null;
    };

    ipcMain.on('screenshot-overlay:ready', (event, data: { sessionId?: unknown; displayId?: unknown }) => {
      const session = verifyOverlaySender(event, data?.sessionId);
      if (!session || typeof data.displayId !== 'number') return;
      const entry = session.overlays.get(data.displayId);
      if (!entry || entry.window.isDestroyed()) return;
      entry.ready = true;
      entry.window.show();
      entry.window.focus();
    });

    ipcMain.on('screenshot-overlay:claim-selection', (event, data: { sessionId?: unknown; displayId?: unknown }) => {
      const session = verifyOverlaySender(event, data?.sessionId);
      if (!session || typeof data.displayId !== 'number') return;
      session.claimedDisplayId = data.displayId;
      for (const [otherId, entry] of session.overlays) {
        if (otherId !== data.displayId && !entry.window.isDestroyed()) {
          entry.window.webContents.send('screenshot-overlay:clear-selection', {
            sessionId: session.sessionId,
          });
        }
      }
    });

    ipcMain.on(
      'screenshot-overlay:forward-command',
      (event, data: { sessionId?: unknown; command?: unknown }) => {
        const session = verifyOverlaySender(event, data?.sessionId);
        if (!session || typeof data.command !== 'string') return;
        const allowed = ['copy', 'chat', 'save', 'pin', 'undo', 'redo'];
        if (!allowed.includes(data.command)) return;
        const targetId = session.claimedDisplayId;
        if (targetId === undefined) return;
        const target = session.overlays.get(targetId);
        if (target && !target.window.isDestroyed() && target.window.webContents !== event.sender) {
          target.window.webContents.send('screenshot-overlay:remote-command', {
            sessionId: session.sessionId,
            command: data.command,
          });
        }
      },
    );

    ipcMain.on('screenshot-overlay:cancel', (event, data: { sessionId?: unknown }) => {
      const session = verifyOverlaySender(event, data?.sessionId);
      if (!session) return;
      this.closeActiveSession(true);
    });

    ipcMain.on(
      'screenshot-overlay:set-ignore-mouse',
      (event, data: { sessionId?: unknown; displayId?: unknown; ignore?: unknown }) => {
        const session = verifyOverlaySender(event, data?.sessionId);
        if (!session || typeof data.displayId !== 'number' || typeof data.ignore !== 'boolean') return;
        const entry = session.overlays.get(data.displayId);
        if (!entry || entry.window.isDestroyed()) return;
        if (data.ignore) {
          entry.window.setIgnoreMouseEvents(true, { forward: true });
        } else {
          entry.window.setIgnoreMouseEvents(false);
        }
      },
    );

    ipcMain.handle('screenshot-overlay:copy-text', (event, text: unknown) => {
      if (!this.active) return false;
      let validSender = false;
      for (const entry of this.active.overlays.values()) {
        if (!entry.window.isDestroyed() && entry.window.webContents === event.sender) {
          validSender = true;
          break;
        }
      }
      if (!validSender || typeof text !== 'string') return false;
      clipboard.writeText(text);
      return true;
    });

    ipcMain.handle(
      'screenshot-overlay:ocr',
      async (event, data: { sessionId?: unknown; pngBase64?: unknown; preferAi?: unknown }) => {
        const session = verifyOverlaySender(event, data?.sessionId);
        if (!session || typeof data.pngBase64 !== 'string') {
          return { ok: false, text: '', engine: 'ai', error: 'Invalid session' } satisfies ScreenshotOcrResponse;
        }
        return this.performOcr(data.pngBase64, Boolean(data.preferAi), session.controller.signal);
      },
    );

    ipcMain.handle(
      'screenshot-overlay:translate',
      async (
        event,
        data: { sessionId?: unknown; pngBase64?: unknown; targetLanguage?: unknown },
      ) => {
        const session = verifyOverlaySender(event, data?.sessionId);
        if (!session || typeof data.pngBase64 !== 'string') {
          return {
            ok: false,
            sourceText: '',
            translatedText: '',
            targetLanguage: 'auto',
            error: 'Invalid session',
          } satisfies ScreenshotTranslateResponse;
        }
        const targetLang =
          data.targetLanguage === 'zh' || data.targetLanguage === 'en' ? data.targetLanguage : 'auto';
        return this.performTranslate(data.pngBase64, targetLang, session.controller.signal);
      },
    );

    ipcMain.handle(
      'screenshot-overlay:scroll-start',
      async (
        event,
        data: { sessionId?: unknown; displayId?: unknown; rect?: unknown },
      ): Promise<ScrollCaptureProgress | null> => {
        const session = verifyOverlaySender(event, data?.sessionId);
        if (!session || typeof data.displayId !== 'number' || !data.rect || typeof data.rect !== 'object') {
          return null;
        }
        const rect = data.rect as ScreenshotRect;
        return this.beginScrollCapture(session, data.displayId, rect);
      },
    );

    ipcMain.handle(
      'screenshot-overlay:scroll-toggle-auto',
      (event, data: { sessionId?: unknown }) => {
        const session = verifyOverlaySender(event, data?.sessionId);
        if (!session?.scrollState) return { ok: false };
        session.scrollState.autoScrolling = !session.scrollState.autoScrolling;
        session.scrollState.quietTicks = 0;
        this.emitScrollProgress(session);
        return { ok: true, autoScrolling: session.scrollState.autoScrolling };
      },
    );

    ipcMain.handle(
      'screenshot-overlay:scroll-finish',
      async (event, data: { sessionId?: unknown; action?: unknown }) => {
        const session = verifyOverlaySender(event, data?.sessionId);
        if (!session?.scrollState) return { ok: false };
        const action =
          data.action === 'save' || data.action === 'pin' || data.action === 'chat' ? data.action : 'copy';
        await this.finishScrollCapture(session, action);
        return { ok: true };
      },
    );

    ipcMain.handle(
      'screenshot-overlay:commit',
      async (
        event,
        data: {
          sessionId?: unknown;
          displayId?: unknown;
          action?: unknown;
          rect?: unknown;
          pngBase64?: unknown;
          width?: unknown;
          height?: unknown;
          prompt?: unknown;
        },
      ) => {
        const session = verifyOverlaySender(event, data?.sessionId);
        if (
          !session ||
          typeof data.displayId !== 'number' ||
          typeof data.pngBase64 !== 'string' ||
          typeof data.action !== 'string' ||
          !data.rect ||
          typeof data.rect !== 'object'
        ) {
          return { ok: false };
        }

        const displayFrame = session.overlays.get(data.displayId)?.frame;
        const rect = data.rect as ScreenshotRect;
        const width = typeof data.width === 'number' ? data.width : rect.width;
        const height = typeof data.height === 'number' ? data.height : rect.height;
        const prompt = typeof data.prompt === 'string' && data.prompt.trim() ? data.prompt.trim() : undefined;
        const action = data.action as 'copy' | 'save' | 'pin' | 'chat' | 'note';

        await this.executeCommitAction({
          session,
          action,
          pngBase64: data.pngBase64,
          localRect: rect,
          displayFrame,
          width,
          height,
          prompt,
        });
        return { ok: true };
      },
    );
  }

  async startCapture(options?: { hideMainWindowOverride?: boolean }): Promise<{ ok: boolean; reason?: string }> {
    if (this.capturing || this.active) {
      return { ok: false, reason: 'already_active' };
    }
    this.registerIpc();
    this.capturing = true;

    const prefs = this.getPreferences();
    const shouldHideMain = options?.hideMainWindowOverride ?? prefs.hideMainWindow;
    const mainWin = this.deps.getMainWindow();
    const wasMainVisible = Boolean(mainWin && !mainWin.isDestroyed() && mainWin.isVisible() && !mainWin.isMinimized());

    const controller = new AbortController();
    try {
      if (shouldHideMain && wasMainVisible && mainWin && !mainWin.isDestroyed()) {
        mainWin.hide();
        await new Promise((resolve) => setTimeout(resolve, 140));
      }

      const bundle = await captureDesktopFrames({
        excludePid: shouldHideMain ? process.pid : 0,
        signal: controller.signal,
      });

      // Exclude auxiliary xopc floating windows (desktop pet, existing pin windows) while keeping mainWindow snappable!
      const auxBounds = BrowserWindow.getAllWindows()
        .filter((w) => w !== mainWin && !w.isDestroyed() && w.isVisible())
        .map((w) => w.getBounds());
      const filteredWindows =
        auxBounds.length === 0
          ? bundle.windows
          : bundle.windows.filter(
              (cand) =>
                !auxBounds.some(
                  (aux) =>
                    Math.abs(cand.x - aux.x) <= 4 &&
                    Math.abs(cand.y - aux.y) <= 4 &&
                    Math.abs(cand.width - aux.width) <= 4 &&
                    Math.abs(cand.height - aux.height) <= 4,
                ),
            );

      if (bundle.status === 'cancelled') {
        if (shouldHideMain && wasMainVisible && mainWin && !mainWin.isDestroyed()) {
          mainWin.show();
        }
        return { ok: false, reason: 'cancelled' };
      }

      if (bundle.status === 'permission_denied') {
        if (shouldHideMain && wasMainVisible && mainWin && !mainWin.isDestroyed()) {
          mainWin.show();
        }
        const zh = this.language() === 'zh';
        void dialog.showMessageBox({
          type: 'info',
          message: zh ? '需要开启屏幕录制权限' : 'Screen Recording Permission Required',
          detail: zh
            ? '请在系统设置 → 隐私与安全性 → 录屏与系统录音中允许 xopc，授权后即可使用框选标注截图。'
            : 'Enable xopc under System Settings → Privacy & Security → Screen Recording to capture and annotate your screen.',
        }).catch(() => undefined);
        return { ok: false, reason: 'permission_denied' };
      }

      if (bundle.frames.length === 0) {
        // Ultimate OS tool fallback if display frames could not be read.
        await captureDesktopScreenshot(controller.signal);
        if (shouldHideMain && wasMainVisible && mainWin && !mainWin.isDestroyed()) {
          mainWin.show();
        }
        return { ok: true };
      }

      const sessionId = randomUUID();
      const session: ActiveOverlaySession = {
        sessionId,
        controller,
        overlays: new Map(),
        restoredMainWindow: !(shouldHideMain && wasMainVisible),
      };
      this.active = session;

      const language = this.language();
      await Promise.all(
        bundle.frames.map(async (frame) => {
          const win = this.createOverlayWindow(frame, bundle.isWayland);
          session.overlays.set(frame.displayId, { window: win, frame, ready: false });
          win.once('closed', () => {
            if (this.active === session) {
              session.overlays.delete(frame.displayId);
              if (session.overlays.size === 0) {
                this.closeActiveSession(true);
              }
            }
          });
          await loadPrivateRendererDocument(win, 'screenshot-overlay');
          if (!win.isDestroyed() && this.active === session) {
            const payload: ScreenshotOverlayPayload = {
              sessionId,
              displayId: frame.displayId,
              bounds: frame.bounds,
              scaleFactor: frame.scaleFactor,
              pixelWidth: frame.pixelWidth,
              pixelHeight: frame.pixelHeight,
              pngBase64: frame.pngBase64,
              windows: filteredWindows,
              language,
              platform: process.platform,
              isWayland: bundle.isWayland,
              imageBounds: frame.imageBounds,
              initialSelection: frame.initialSelection,
            };
            win.webContents.send('screenshot-overlay:session', payload);
          }
        }),
      );

      return { ok: true };
    } catch (error) {
      const aborted = controller.signal.aborted;
      this.closeActiveSession(false);
      if (shouldHideMain && wasMainVisible && mainWin && !mainWin.isDestroyed()) {
        mainWin.show();
      }
      if (!aborted) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn({ err: error }, `Desktop screenshot failed: ${message}`);
        const zh = this.language() === 'zh';
        void dialog.showMessageBox({
          type: 'error',
          message: zh ? '无法截图' : 'Could not capture the screen',
          detail:
            process.platform === 'linux'
              ? zh
                ? '请检查桌面截图权限，或确认系统已安装截图服务。'
                : 'Check your desktop screenshot permissions and that a screenshot service is installed.'
              : undefined,
        }).catch(() => undefined);
      }
      return { ok: false, reason: 'error' };
    } finally {
      this.capturing = false;
    }
  }

  private createOverlayWindow(frame: DisplayCaptureFrame, isWayland: boolean): BrowserWindow {
    const win = new BrowserWindow({
      x: frame.bounds.x,
      y: frame.bounds.y,
      width: frame.bounds.width,
      height: frame.bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreen: isWayland,
      fullscreenable: isWayland,
      enableLargerThanScreen: true,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      backgroundColor: '#00000000',
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/screenshot-overlay.cjs'),
        partition: 'screenshot-overlay-private',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: !this.deps.disableSandbox,
        backgroundThrottling: false,
      },
    });

    if (!isWayland) {
      win.setBounds(frame.bounds, false);
    }
    win.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    return win;
  }

  private recordHistory(
    pngBase64: string,
    width: number,
    height: number,
    action: ScreenshotHistoryItem['action'],
  ): void {
    try {
      const img = nativeImage.createFromBuffer(Buffer.from(pngBase64, 'base64'));
      const thumb = img.isEmpty() ? '' : img.resize({ width: Math.min(240, Math.max(32, width)) }).toDataURL();
      this.history.unshift({
        id: randomUUID(),
        createdAt: Date.now(),
        width,
        height,
        action,
        previewDataUrl: thumb,
      });
      if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;
    } catch {
      /* non-fatal */
    }
  }

  private async copyPngBase64ToClipboard(pngBase64: string): Promise<void> {
    const pngBytes = Buffer.from(pngBase64, 'base64');
    if (pngBytes.byteLength === 0) return;
    const blob = new Blob([new Uint8Array(pngBytes)], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  private async savePngBase64ToDisk(pngBase64: string, parent?: BrowserWindow): Promise<boolean> {
    const defaultPath = join(app.getPath('pictures'), `xopc-screenshot-${timestampSlug()}.png`);
    const result = parent && !parent.isDestroyed()
      ? await dialog.showSaveDialog(parent, {
          defaultPath,
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
        })
      : await dialog.showSaveDialog({
          defaultPath,
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
        });

    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, Buffer.from(pngBase64, 'base64'));
    return true;
  }

  private deliverToRenderer(payload: ScreenshotChatDelivery): void {
    this.pendingDeliveries.push(payload);
    if (this.pendingDeliveries.length > MAX_HISTORY) {
      this.pendingDeliveries.shift();
    }
    this.deps.focusOrCreateMainWindow();
    const win = this.deps.getMainWindow();
    if (win && !win.isDestroyed() && !win.webContents.isLoadingMainFrame()) {
      win.webContents.send('screenshot:deliver-to-chat', payload);
    }
  }

  private async executeCommitAction(params: {
    session: ActiveOverlaySession;
    action: 'copy' | 'save' | 'pin' | 'chat' | 'note';
    pngBase64: string;
    localRect: ScreenshotRect;
    displayFrame?: DisplayCaptureFrame;
    width: number;
    height: number;
    prompt?: string;
  }): Promise<void> {
    const { action, pngBase64, localRect, displayFrame, width, height, prompt } = params;

    // Close overlays first so save dialogs or pin windows aren't obscured by screen-saver overlays!
    const shouldRestoreMain = action === 'chat' || action === 'note' ? false : true;
    this.closeActiveSession(shouldRestoreMain);

    this.recordHistory(pngBase64, width, height, action);

    if (action === 'copy') {
      await this.copyPngBase64ToClipboard(pngBase64);
      return;
    }

    if (action === 'save') {
      await this.savePngBase64ToDisk(pngBase64);
      return;
    }

    if (action === 'pin') {
      const screenBounds = displayFrame
        ? displayToScreenRect(localRect, displayFrame.bounds)
        : localRect;
      await this.pinManager.createPin({
        screenBounds,
        pngBase64,
        scaleFactor: displayFrame?.scaleFactor ?? 1,
      });
      return;
    }

    if (action === 'chat' || action === 'note') {
      await this.copyPngBase64ToClipboard(pngBase64);
      this.deliverToRenderer({
        id: randomUUID(),
        createdAt: Date.now(),
        pngBase64,
        fileName: `screenshot-${timestampSlug()}.png`,
        width,
        height,
        prompt,
        targetMode: action,
      });
    }
  }

  private async performOcr(
    pngBase64: string,
    preferAi: boolean,
    signal: AbortSignal,
  ): Promise<ScreenshotOcrResponse> {
    const buffer = Buffer.from(pngBase64, 'base64');
    if (!preferAi) {
      const local = await runPlatformLocalOcr(buffer, signal);
      if (local && local.ok && local.text.trim()) {
        return local;
      }
    }

    const ai = await this.callGatewayScreenshotAi({
      mode: 'ocr',
      imageBase64: pngBase64,
      signal,
    });
    if (ai.ok === true) {
      return {
        ok: true,
        text: String(ai.data['text'] ?? ''),
        engine: 'ai',
        model: typeof ai.data['model'] === 'string' ? ai.data['model'] : undefined,
      };
    }

    // If AI failed and we skipped local earlier, try local as fallback!
    if (preferAi) {
      const fallbackLocal = await runPlatformLocalOcr(buffer, signal);
      if (fallbackLocal?.ok) return fallbackLocal;
    }

    return {
      ok: false,
      text: '',
      engine: 'ai',
      error: (ai as { ok: false; error: string }).error,
    };
  }

  private async performTranslate(
    pngBase64: string,
    targetLanguage: 'auto' | 'zh' | 'en',
    signal: AbortSignal,
  ): Promise<ScreenshotTranslateResponse> {
    const ai = await this.callGatewayScreenshotAi({
      mode: 'translate',
      imageBase64: pngBase64,
      targetLanguage,
      signal,
    });
    if (ai.ok !== true) {
      return {
        ok: false,
        sourceText: '',
        translatedText: '',
        targetLanguage,
        error: (ai as { ok: false; error: string }).error,
      };
    }
    return {
      ok: true,
      sourceText: String(ai.data['sourceText'] ?? ''),
      translatedText: String(ai.data['translatedText'] ?? ''),
      targetLanguage: String(ai.data['targetLanguage'] ?? targetLanguage),
      model: typeof ai.data['model'] === 'string' ? ai.data['model'] : undefined,
    };
  }

  private async callGatewayScreenshotAi(params: {
    mode: 'ocr' | 'translate';
    imageBase64: string;
    targetLanguage?: 'auto' | 'zh' | 'en';
    signal: AbortSignal;
  }): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
    const zh = this.language() === 'zh';
    const target = this.deps.getGatewayTarget();
    if (!target) {
      return {
        ok: false,
        error: zh ? 'Gateway 尚未就绪，请稍后重试。' : 'Gateway is not connected yet.',
      };
    }
    try {
      const response = await fetch(new URL('/api/screenshot/analyze', target.origin), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${target.token}`,
          Origin: target.origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: params.mode,
          imageBase64: params.imageBase64,
          mimeType: 'image/png',
          targetLanguage: params.targetLanguage ?? 'auto',
        }),
        signal: params.signal,
      });
      const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok || !json || json['ok'] !== true) {
        const rawErr = typeof json?.['error'] === 'string' ? json['error'] : `HTTP ${response.status}`;
        const friendly = rawErr.startsWith('NO_VISION_MODEL')
          ? zh
            ? '未配置支持视觉的模型，请前往「设置 → 模型」添加多模态模型。'
            : 'No vision-capable model configured. Configure one in Settings → Models.'
          : rawErr;
        return { ok: false, error: friendly };
      }
      return { ok: true, data: json };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async beginScrollCapture(
    session: ActiveOverlaySession,
    displayId: number,
    rect: ScreenshotRect,
  ): Promise<ScrollCaptureProgress | null> {
    const overlayEntry = session.overlays.get(displayId);
    if (!overlayEntry || overlayEntry.frame.imageBounds || overlayEntry.frame.initialSelection) return null;

    // Close other monitor overlays and make this monitor overlay pass mouse wheel events through!
    for (const [id, entry] of session.overlays) {
      if (id !== displayId && !entry.window.isDestroyed()) {
        entry.window.close();
        session.overlays.delete(id);
      }
    }

    const stitcher = new ScrollStitcher(16_384);

    // Seed first frame from the initial frozen screenshot so we don't capture our own overlay border!
    const initialFull = nativeImage.createFromBuffer(Buffer.from(overlayEntry.frame.pngBase64, 'base64'));
    if (!initialFull.isEmpty()) {
      const imgSize = initialFull.getSize();
      const scaleX = imgSize.width / Math.max(1, overlayEntry.frame.bounds.width);
      const scaleY = imgSize.height / Math.max(1, overlayEntry.frame.bounds.height);
      const cropped = initialFull.crop({
        x: Math.max(0, Math.round(rect.x * scaleX)),
        y: Math.max(0, Math.round(rect.y * scaleY)),
        width: Math.max(16, Math.round(rect.width * scaleX)),
        height: Math.max(32, Math.round(rect.height * scaleY)),
      });
      const bmp = cropped.toBitmap();
      const cSize = cropped.getSize();
      if (bmp.byteLength === cSize.width * cSize.height * 4) {
        const rgba = new Uint8Array(bmp.byteLength);
        for (let i = 0; i + 3 < bmp.byteLength; i += 4) {
          rgba[i] = bmp[i + 2]!;
          rgba[i + 1] = bmp[i + 1]!;
          rgba[i + 2] = bmp[i]!;
          rgba[i + 3] = bmp[i + 3]!;
        }
        stitcher.pushFrame({ width: cSize.width, height: cSize.height, data: rgba });
      }
    }

    // Exclude our own overlay window from OS screen capture on macOS & Windows so neither border nor dock is captured!
    try {
      overlayEntry.window.setContentProtection(true);
    } catch {
      /* platform may not support content protection */
    }
    overlayEntry.window.setIgnoreMouseEvents(true, { forward: true });

    // Capture slightly inset by 2px so even on Linux X11 our 2px green dashed border is never included in stitched frames!
    const captureRect: ScreenshotRect = {
      x: rect.x + 2,
      y: rect.y + 2,
      width: Math.max(16, rect.width - 4),
      height: Math.max(32, rect.height - 4),
    };
    if (stitcher.frameCount > 0) {
      // Reset stitcher to match exact inset capture dimensions on first live frame.
      const firstLive = await captureDisplayRegionRgba(displayId, captureRect, session.controller.signal);
      if (this.active !== session || session.controller.signal.aborted) {
        return null;
      }
      if (firstLive) {
        const freshStitcher = new ScrollStitcher(16_384);
        freshStitcher.pushFrame(firstLive);
        session.scrollState = {
          displayId,
          rect,
          stitcher: freshStitcher,
          busy: false,
          autoScrolling: false,
          quietTicks: 0,
        };
      }
    }

    if (this.active !== session || session.controller.signal.aborted) {
      return null;
    }

    if (!session.scrollState) {
      session.scrollState = {
        displayId,
        rect,
        stitcher,
        busy: false,
        autoScrolling: false,
        quietTicks: 0,
      };
    }

    const timer = setInterval(() => {
      void this.tickScrollCapture(session, captureRect);
    }, 210);
    timer.unref();
    session.scrollState.timer = timer;

    return this.buildScrollProgress(session);
  }

  private async tickScrollCapture(session: ActiveOverlaySession, captureRect: ScreenshotRect): Promise<void> {
    const sc = session.scrollState;
    if (!sc || sc.busy || this.active !== session) return;
    sc.busy = true;
    try {
      if (sc.autoScrolling) {
        const scrolled = await sendPlatformAutoScrollStep(
          sc.displayId,
          captureRect,
          session.controller.signal,
        );
        if (!scrolled) {
          sc.autoScrolling = false;
        }
      }

      const rgba = await captureDisplayRegionRgba(sc.displayId, captureRect, session.controller.signal);
      if (!rgba || this.active !== session) return;
      const step = sc.stitcher.pushFrame(rgba);
      if (step.accepted) {
        sc.quietTicks = 0;
        if (step.reachedLimit) {
          sc.autoScrolling = false;
        }
        this.emitScrollProgress(session);
      } else if (sc.autoScrolling) {
        sc.quietTicks += 1;
        if (sc.quietTicks >= 7) {
          // Reached bottom of scrollable container automatically!
          sc.autoScrolling = false;
          this.emitScrollProgress(
            session,
            this.language() === 'zh' ? '已滚动到底部，点击完成导出' : 'Reached bottom of page',
          );
        }
      }
    } catch {
      /* ignore transient frame failure */
    } finally {
      sc.busy = false;
    }
  }

  private buildScrollProgress(session: ActiveOverlaySession, statusMessage?: string): ScrollCaptureProgress {
    const sc = session.scrollState!;
    const dims = sc.stitcher.dimensions;
    let previewPngBase64: string | undefined;
    const composite = sc.stitcher.buildComposite();
    if (composite && composite.width > 0 && composite.height > 0) {
      const png = rgbaFrameToPngBuffer(composite);
      const previewImg = nativeImage.createFromBuffer(png);
      if (!previewImg.isEmpty()) {
        const thumbW = Math.min(220, composite.width);
        previewPngBase64 = previewImg.resize({ width: thumbW }).toPNG().toString('base64');
      }
    }
    return {
      sessionId: session.sessionId,
      active: true,
      autoScrolling: sc.autoScrolling,
      autoScrollSupported: isAutoScrollSupported(),
      frameCount: sc.stitcher.frameCount,
      pixelWidth: dims.width,
      pixelHeight: dims.height,
      previewPngBase64,
      statusMessage,
    };
  }

  private emitScrollProgress(session: ActiveOverlaySession, statusMessage?: string): void {
    const sc = session.scrollState;
    if (!sc) return;
    const entry = session.overlays.get(sc.displayId);
    if (!entry || entry.window.isDestroyed()) return;
    entry.window.webContents.send(
      'screenshot-overlay:scroll-progress',
      this.buildScrollProgress(session, statusMessage),
    );
  }

  private async finishScrollCapture(
    session: ActiveOverlaySession,
    action: 'copy' | 'save' | 'pin' | 'chat',
  ): Promise<void> {
    const sc = session.scrollState;
    if (!sc) return;
    if (sc.timer) clearInterval(sc.timer);
    sc.timer = undefined;

    const composite = sc.stitcher.buildComposite();
    const displayFrame = session.overlays.get(sc.displayId)?.frame;
    if (!composite) {
      this.closeActiveSession(true);
      return;
    }

    const pngBuffer = rgbaFrameToPngBuffer(composite);
    const pngBase64 = pngBuffer.toString('base64');
    const scale = displayFrame?.scaleFactor ?? 1;
    const logicalW = Math.max(48, Math.round(composite.width / scale));
    const logicalH = Math.min(720, Math.max(64, Math.round(composite.height / scale)));

    await this.executeCommitAction({
      session,
      action,
      pngBase64,
      localRect: { ...sc.rect, width: logicalW, height: logicalH },
      displayFrame,
      width: logicalW,
      height: Math.round(composite.height / scale),
    });
  }

  closeActiveSession(restoreMainWindow: boolean): void {
    const session = this.active;
    if (!session) return;
    this.active = null;
    if (session.scrollState?.timer) {
      clearInterval(session.scrollState.timer);
    }
    session.controller.abort();
    for (const entry of session.overlays.values()) {
      if (!entry.window.isDestroyed()) {
        entry.window.destroy();
      }
    }
    session.overlays.clear();

    if (restoreMainWindow && !session.restoredMainWindow) {
      session.restoredMainWindow = true;
      const mainWin = this.deps.getMainWindow();
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.show();
      }
    }
  }

  dispose(): void {
    this.closeActiveSession(false);
    this.pinManager.dispose();
    if (this.ipcRegistered) {
      this.ipcRegistered = false;
      ipcMain.removeHandler('screenshot:start');
      ipcMain.removeHandler('screenshot:get-prefs');
      ipcMain.removeHandler('screenshot:set-prefs');
      ipcMain.removeHandler('screenshot:get-history');
      ipcMain.removeHandler('screenshot:take-pending-deliveries');
      ipcMain.removeHandler('screenshot:ack-delivery');
      ipcMain.removeAllListeners('screenshot-overlay:ready');
      ipcMain.removeAllListeners('screenshot-overlay:claim-selection');
      ipcMain.removeAllListeners('screenshot-overlay:forward-command');
      ipcMain.removeAllListeners('screenshot-overlay:cancel');
      ipcMain.removeAllListeners('screenshot-overlay:set-ignore-mouse');
      ipcMain.removeHandler('screenshot-overlay:copy-text');
      ipcMain.removeHandler('screenshot-overlay:ocr');
      ipcMain.removeHandler('screenshot-overlay:translate');
      ipcMain.removeHandler('screenshot-overlay:scroll-start');
      ipcMain.removeHandler('screenshot-overlay:scroll-toggle-auto');
      ipcMain.removeHandler('screenshot-overlay:scroll-finish');
      ipcMain.removeHandler('screenshot-overlay:commit');
    }
  }
}

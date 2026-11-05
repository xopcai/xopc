import { randomUUID } from 'node:crypto';

import { BrowserWindow, session, type Session } from 'electron';

import type { GatewayConnectionPreview } from './connection-manager.js';
import { establishRemoteConsoleSession } from './remote-console.js';
import { RemoteGatewayUpstream } from './remote-upstream.js';
import { RemoteWindowPresentation } from './window-presentation.js';

export class RemoteConsoleWindow {
  private window?: BrowserWindow;
  private partition?: Session;
  private origin?: string;
  private activeEpoch?: number;
  private failedCleanup = false;
  private closing?: Promise<void>;

  constructor(private readonly manager: GatewayConnectionPreview, private readonly recover: () => void,
    private readonly presentation = new RemoteWindowPresentation()) {}

  presentationState() {
    return { visible: this.window?.isVisible() ?? false, focused: this.window?.isFocused() ?? false };
  }

  captureWindow(): BrowserWindow | undefined {
    const window = this.window;
    if (!window || window.isDestroyed() || this.activeEpoch !== this.manager.snapshot().epoch) return;
    return window.webContents.getURL().split('#')[0] === `${this.origin}/` ? window : undefined;
  }

  async connect(epoch: unknown, id: unknown) {
    if (epoch !== this.manager.snapshot().epoch) throw new Error('STALE_CONNECTION_EPOCH');
    await this.close();
    if (this.failedCleanup) throw new Error('CONSOLE_CLEANUP_RESTART_REQUIRED');
    const started = await this.manager.beginConnection(epoch, id);
    const target = await this.manager.privateConnection(started.epoch, id);
    const upstream = new RemoteGatewayUpstream(target);
    try {
      const identity = await upstream.authenticate();
      const snapshot = await this.manager.pinIdentity(started.epoch, id, identity);
      this.activeEpoch = snapshot.epoch;
      this.origin = target.origin;
      const partition = session.fromPartition(`remote-console-${randomUUID()}`);
      this.partition = partition;
      partition.setPermissionCheckHandler(() => false);
      partition.setPermissionRequestHandler((_window, _permission, done) => done(false));
      partition.on('will-download', event => event.preventDefault());
      await establishRemoteConsoleSession(partition, target.origin, target.token);
      const window = new BrowserWindow({
        width: 1280, height: 860, minWidth: 800, minHeight: 600,
        show: this.presentation.showInitially, paintWhenInitiallyHidden: this.presentation.showInitially, title: 'xopc',
        webPreferences: {
          backgroundThrottling: false,
          // Remote content has browser APIs only; no local Electron preload or IPC.
          session: partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, navigateOnDragDrop: false,
        },
      });
      this.window = window;
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.webContents.on('will-frame-navigate', event => event.preventDefault());
      window.webContents.on('will-redirect', event => event.preventDefault());
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      const recover = () => {
        if (this.window !== window) return;
        void this.close().catch(() => {}).finally(this.recover);
      };
      window.webContents.on('render-process-gone', recover);
      window.once('closed', recover);
      await window.loadURL(`${target.origin}/#/chat`);
      return { ok: true, snapshot: this.manager.snapshot() };
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      upstream.close();
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    const partition = this.partition, window = this.window, origin = this.origin;
    this.window = undefined; this.partition = undefined; this.origin = undefined; this.activeEpoch = undefined;
    if (window && !window.isDestroyed()) window.destroy();
    this.closing = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([(async () => {
          if (!partition) return;
          if (origin) await partition.fetch(`${origin}/api/browser-session`, {
            method: 'DELETE', headers: { Origin: origin }, credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(5_000),
          }).catch(() => {});
          await partition.closeAllConnections();
          await partition.clearStorageData();
          await partition.clearCache();
        })(), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('CONSOLE_CLEANUP_RESTART_REQUIRED')), 15_000);
        })]);
      } catch (error) {
        this.failedCleanup = true;
        throw error;
      } finally {
        clearTimeout(timer);
      }
    })().finally(() => { this.closing = undefined; });
    return this.closing;
  }
}

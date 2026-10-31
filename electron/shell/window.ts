import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { BrowserWindow, session, type IpcMainInvokeEvent, type Session } from 'electron';

import type { GatewayConnectionPreview } from '../gateway/connection-manager.js';
import { RemoteChatStateStore, type ChatNamespace } from '../chat/state.js';
import { ShellController } from './controller.js';

export class RemoteShellWindow {
  private window?: BrowserWindow;
  private worker?: ShellController;
  private partition?: Session;
  private origin?: string;
  private failedCleanup = false;
  private bootstrapped = false;
  private activeEpoch?: number;
  private closing?: Promise<void>;
  private namespace?: ChatNamespace;
  constructor(private readonly mainDirectory: string, private readonly assets: string,
    private readonly manager: GatewayConnectionPreview, private readonly recover: () => void, private readonly state: RemoteChatStateStore) {}

  authorize(event: IpcMainInvokeEvent, channel: string) {
    if (!['shell:bootstrap', 'shell:recover', 'shell:state-read', 'shell:state-write'].includes(channel)) throw new Error('REMOTE_CAPABILITY_DISABLED');
    if (!this.window || this.window.isDestroyed() || event.sender !== this.window.webContents
      || event.senderFrame !== this.window.webContents.mainFrame || event.senderFrame?.url !== `${this.origin}/`
      || event.sender.getURL() !== `${this.origin}/` || this.activeEpoch !== this.manager.snapshot().epoch) throw new Error('UNTRUSTED_SHELL_WINDOW');
  }
  async connect(epoch: unknown, id: unknown) {
    if (epoch !== this.manager.snapshot().epoch) throw new Error('STALE_CONNECTION_EPOCH');
    await this.close();
    if (this.failedCleanup) throw new Error('SHELL_CLEANUP_RESTART_REQUIRED');
    const target = await this.manager.privateConnection(epoch, id);
    const worker = new ShellController(this.mainDirectory, () => { void this.close().catch(() => {}); this.recover(); });
    this.worker = worker;
    try {
      const identity = await worker.request<{ gatewayId: string; publicKey: string }>('authenticate', { target });
      const snapshot = await this.manager.pinIdentity(epoch, id, identity);
      this.namespace = { profileId: String(id), ...identity };
      await this.state.read(this.namespace);
      const connection = await worker.request<{ origin: string; proof: string; epoch: number }>('activate', { assets: this.assets, epoch: snapshot.epoch });
      this.origin = connection.origin; this.activeEpoch = snapshot.epoch; this.bootstrapped = false;
      const partition = session.fromPartition(`remote-shell-${randomUUID()}`); this.partition = partition;
      partition.setPermissionCheckHandler(() => false);
      partition.setPermissionRequestHandler((_w, _p, done) => done(false));
      partition.on('will-download', event => event.preventDefault());
      const window = new BrowserWindow({ width: 900, height: 700, title: 'xopc · Remote Shell (S2)', webPreferences: {
        session: partition, preload: join(this.assets, 'shell.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, navigateOnDragDrop: false,
      } });
      this.window = window;
      partition.webRequest.onBeforeSendHeaders({ urls: [`${connection.origin}/*`, `${connection.origin.replace(/^http/, 'ws')}/*`] }, (details, done) => {
        const headers = { ...details.requestHeaders };
        for (const key of Object.keys(headers)) if (key.toLowerCase() === 'x-xopc-desktop-window') delete headers[key];
        if (this.window === window && this.activeEpoch === this.manager.snapshot().epoch && !window.isDestroyed() && details.webContentsId === window.webContents.id
          && (!details.frame || details.frame === window.webContents.mainFrame) && window.webContents.getURL() === `${connection.origin}/`) {
          headers['X-Xopc-Desktop-Window'] = connection.proof;
        }
        done({ requestHeaders: headers });
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', e => e.preventDefault());
      window.webContents.on('will-frame-navigate', e => e.preventDefault());
      window.webContents.on('will-redirect', e => e.preventDefault());
      window.webContents.on('will-attach-webview', e => e.preventDefault());
      window.webContents.on('render-process-gone', () => { void this.close().catch(() => {}); this.recover(); });
      window.once('closed', () => { if (this.window === window) { void this.close().catch(() => {}); this.recover(); } });
      await window.loadURL(`${connection.origin}/`);
      return { ok: true, snapshot: this.manager.snapshot(), shell: { status: 'authenticated-transport', gatewayId: identity.gatewayId, localCapabilities: false } };
    } catch (error) { await this.close(); throw error; }
  }
  readState() { if (!this.namespace) throw new Error('SHELL_CLOSED'); return this.state.read(this.namespace); }
  writeState(value: unknown) { if (!this.namespace) throw new Error('SHELL_CLOSED'); return this.state.write(this.namespace, value); }
  async bootstrap() {
    if (this.bootstrapped || !this.partition || !this.worker || !this.origin) throw new Error('SHELL_BOOTSTRAP_CONSUMED');
    this.bootstrapped = true;
    const cookie = await this.worker.request<{ name: string; value: string; expiresAt: number }>('bootstrap');
    const partition = this.partition, origin = this.origin;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([partition.cookies.set({ url: origin, name: cookie.name, value: cookie.value, httpOnly: true, secure: false, sameSite: 'strict', path: '/', expirationDate: cookie.expiresAt / 1000 }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { this.failedCleanup = true; reject(new Error('SHELL_COOKIE_RESTART_REQUIRED')); }, 15_000); })]);
    } finally { clearTimeout(timer); }
    return { ok: true };
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    const worker = this.worker, partition = this.partition, window = this.window;
    this.worker = undefined; this.partition = undefined; this.window = undefined; this.origin = undefined; this.activeEpoch = undefined; this.namespace = undefined;
    if (window && !window.isDestroyed()) window.destroy();
    this.closing = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([(async () => {
          await worker?.stop();
          if (partition) { partition.webRequest.onBeforeSendHeaders(null); await partition.closeAllConnections(); await partition.clearStorageData(); await partition.clearCache(); }
        })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('SHELL_CLEANUP_RESTART_REQUIRED')), 15_000); })]);
      } catch (error) { this.failedCleanup = true; throw error; }
      finally { clearTimeout(timer); }
    })().finally(() => { this.closing = undefined; });
    return this.closing;
  }
}

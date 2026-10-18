import { createHash, randomUUID } from 'node:crypto';
import { BrowserWindow, WebContentsView, dialog, session, type IpcMain, type IpcMainInvokeEvent } from 'electron';

import { assertTrustedRenderer } from '../ipc/trusted-renderer.js';
import { browserHttpUrl, clipBrowserBounds } from './url-policy.js';
import type { BrowserBounds, EmbeddedBrowserEvent, EmbeddedBrowserState } from './types.js';

type Entry = { view: WebContentsView; contents: Electron.WebContents; state: EmbeddedBrowserState; requested?: string; closing?: (closed: boolean) => void };
export class EmbeddedBrowserHost {
  private tabs = new Map<string, Entry>();
  private active: string | null = null;
  private identity: string | null = null;
  private downloadHandlers = new Map<Electron.Session, (event: Electron.Event, item: Electron.DownloadItem, source: Electron.WebContents) => void>();
  constructor(private win: BrowserWindow) {
    win.on('closed', () => this.dispose());
    win.webContents.on('render-process-gone', () => this.dispose());
    win.webContents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) this.dispose(); });
    win.on('minimize', () => this.hideActive());
    win.on('hide', () => this.hideActive());
  }
  private emit(event: EmbeddedBrowserEvent) {
    if (!this.win.isDestroyed() && !this.win.webContents.isDestroyed()) this.win.webContents.send('browser:event', event);
  }
  private entry(id: string): Entry {
    const tab = this.tabs.get(id);
    if (!tab || tab.contents.isDestroyed()) throw new Error('Browser tab is unavailable');
    return tab;
  }
  private update(tab: Entry, patch: Partial<EmbeddedBrowserState> = {}) {
    if (tab.contents.isDestroyed()) return;
    const wc = tab.contents;
    Object.assign(tab.state, { url: tab.state.error ? tab.requested ?? wc.getURL() : wc.getURL() === 'about:blank' ? tab.requested ?? '' : wc.getURL() || tab.requested || '', title: wc.getTitle() || 'Browser', loading: wc.isLoading(), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() }, patch);
    this.emit({ kind: 'state', state: { ...tab.state } });
  }
  ensure(input: { workspaceTabId: string; scope: string; identity: string }): EmbeddedBrowserState {
    for (const value of [input?.workspaceTabId, input?.scope, input?.identity]) if (typeof value !== 'string' || !value || value.length > 1024) throw new Error('Invalid browser tab owner');
    if (this.identity !== input.identity) { this.dispose(); this.identity = input.identity; }
    const existing = [...this.tabs.values()].find(t => t.state.workspaceTabId === input.workspaceTabId);
    if (existing) { existing.state.scope = input.scope; return { ...existing.state }; }
    if (this.tabs.size >= 24) throw new Error('Close a browser tab before opening another (limit: 24)');
    const partition = `persist:xopc-browser-${createHash('sha256').update(input.identity).digest('hex').slice(0, 24)}`;
    const profile = session.fromPartition(partition);
    profile.setPermissionCheckHandler(() => false);
    profile.setPermissionRequestHandler((wc, permission, callback) => {
      callback(false);
      const tab = [...this.tabs.values()].find(t => t.contents === wc);
      if (tab) this.update(tab, { notice: `Site permission blocked: ${permission}` });
    });
    profile.setDevicePermissionHandler(() => false);
    const view = new WebContentsView({ webPreferences: { session: profile, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, navigateOnDragDrop: false } });
    view.setBackgroundColor('#ffffff');
    view.setVisible(false);
    const tab: Entry = { view, contents: view.webContents, state: { id: randomUUID(), workspaceTabId: input.workspaceTabId, scope: input.scope, url: '', title: 'Browser', loading: false, canGoBack: false, canGoForward: false } };
    this.tabs.set(tab.state.id, tab);
    const wc = view.webContents;
    wc.setAudioMuted(true);
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !(input.meta || input.control)) return;
      if (input.key.toLowerCase() === 'l') { event.preventDefault(); this.win.webContents.focus(); this.emit({ kind: 'focus-address', workspaceTabId: tab.state.workspaceTabId }); }
      if (input.key.toLowerCase() === 'r') { event.preventDefault(); this.command(tab.state.id, 'reload'); }
    });
    wc.setWindowOpenHandler(({ url }) => {
      try { this.emit({ kind: 'popup', url: browserHttpUrl(url), scope: tab.state.scope, sourceTabId: tab.state.workspaceTabId }); } catch { this.update(tab, { notice: 'This link uses an unsupported protocol.' }); }
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => { try { browserHttpUrl(url); } catch { event.preventDefault(); this.update(tab, { notice: 'This navigation was blocked.' }); } });
    wc.on('will-redirect', (event, url) => { try { browserHttpUrl(url); } catch { event.preventDefault(); this.update(tab, { notice: 'This redirect was blocked.' }); } });
    wc.on('will-attach-webview', event => event.preventDefault());
    wc.on('certificate-error', (event, _url, _error, _certificate, callback) => { event.preventDefault(); callback(false); this.update(tab, { error: 'The site certificate could not be verified.' }); });
    wc.on('did-start-navigation', (_event, url, inPlace, main) => { if (main && !inPlace) { try { tab.requested = browserHttpUrl(url); } catch { /* Unsupported navigations are blocked separately. */ } } });
    wc.on('did-start-loading', () => this.update(tab, { error: undefined, crashed: false }));
    wc.on('did-stop-loading', () => this.update(tab));
    wc.on('did-navigate', () => this.update(tab));
    wc.on('did-navigate-in-page', () => this.update(tab));
    wc.on('page-title-updated', () => this.update(tab));
    wc.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => { if (isMainFrame && code !== -3) this.update(tab, { error: `Page could not be loaded (${code}).`, loading: false }); });
    wc.on('render-process-gone', () => { view.setVisible(false); this.update(tab, { crashed: true, loading: false, error: 'This page stopped responding. Reload to recover.' }); });
    wc.on('will-prevent-unload', event => {
      const leave = dialog.showMessageBoxSync(this.win, { type: 'question', message: 'Leave this page?', detail: 'Changes you made on this page may not be saved.', buttons: ['Stay', 'Leave'], defaultId: 0, cancelId: 0, noLink: true }) === 1;
      if (leave) event.preventDefault();
      else { tab.closing?.(false); tab.closing = undefined; }
    });
    wc.on('destroyed', () => { if (this.active === tab.state.id) this.hideActive(); this.tabs.delete(tab.state.id); tab.closing?.(true); });
    if (!this.downloadHandlers.has(profile)) {
      const download = (_event: Electron.Event, item: Electron.DownloadItem, source: Electron.WebContents) => {
        const target = [...this.tabs.values()].find(t => t.contents === source);
        if (!target) return;
        item.setSaveDialogOptions({ title: 'Save download' });
        this.update(target, { notice: `Downloading ${item.getFilename()}` });
        item.on('updated', () => {
          const total = item.getTotalBytes();
          this.update(target, { notice: total > 0 ? `Downloading ${item.getFilename()} (${Math.round(item.getReceivedBytes() / total * 100)}%)` : `Downloading ${item.getFilename()}` });
        });
        item.once('done', (_event, state) => this.update(target, { notice: state === 'completed' ? `Downloaded ${item.getFilename()}` : `Download ${state}` }));
      };
      profile.on('will-download', download);
      this.downloadHandlers.set(profile, download);
    }
    return { ...tab.state };
  }
  navigate(id: string, url: string) {
    const tab = this.entry(id);
    const target = browserHttpUrl(url);
    tab.requested = target;
    this.update(tab, { error: undefined, notice: undefined, crashed: false, url: target });
    void tab.contents.loadURL(target).catch(() => {});
  }
  command(id: string, command: string) {
    const tab = this.entry(id), wc = tab.contents;
    if (command === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (command === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (command === 'reload') { if (tab.state.error && tab.requested) this.navigate(id, tab.requested); else { this.update(tab, { error: undefined, crashed: false }); wc.reload(); } }
    else if (command === 'stop') { wc.stop(); this.update(tab); }
    else if (!['back', 'forward'].includes(command)) throw new Error('Invalid browser command');
  }
  present(id: string, bounds: BrowserBounds | null) {
    if (bounds === null && !this.tabs.has(id)) return;
    const tab = this.entry(id);
    if (!bounds) { if (this.active === id) this.hideActive(); return; }
    const [width, height] = this.win.getContentSize();
    const zoom = this.win.webContents.getZoomFactor();
    const clipped = clipBrowserBounds({ x: bounds.x * zoom, y: bounds.y * zoom, width: bounds.width * zoom, height: bounds.height * zoom }, width, height);
    if (!clipped.width || !clipped.height || this.win.isMinimized() || !this.win.isVisible()) { if (this.active === id) this.hideActive(); return; }
    if (this.active !== id) { this.hideActive(); this.win.contentView.addChildView(tab.view); this.active = id; }
    tab.view.setBounds(clipped);
    tab.view.setVisible(true);
    tab.contents.setAudioMuted(false);
  }
  private hideActive() {
    const old = this.active && this.tabs.get(this.active);
    if (old) {
      if (!old.contents.isDestroyed()) { old.view.setVisible(false); old.contents.setAudioMuted(true); }
      if (!this.win.isDestroyed()) this.win.contentView.removeChildView(old.view);
    }
    this.active = null;
  }
  close(id: string): Promise<boolean> {
    const tab = this.entry(id);
    if (tab.closing) throw new Error('This tab is already closing');
    return new Promise(resolve => { tab.closing = resolve; tab.contents.close({ waitForBeforeUnload: true }); });
  }
  dispose() {
    this.hideActive();
    for (const tab of [...this.tabs.values()]) {
      tab.closing?.(true); tab.closing = undefined;
      if (!tab.contents.isDestroyed()) tab.contents.close();
    }
    this.tabs.clear();
    for (const [profile, handler] of this.downloadHandlers) {
      profile.removeListener('will-download', handler);
      profile.setPermissionCheckHandler(null);
      profile.setPermissionRequestHandler(null);
      profile.setDevicePermissionHandler(null);
    }
    this.downloadHandlers.clear();
  }
}

export function registerBrowserIpc(ipc: IpcMain, getWindow: () => BrowserWindow | null) {
  const hosts = new WeakMap<BrowserWindow, EmbeddedBrowserHost>();
  const host = (event: IpcMainInvokeEvent) => {
    assertTrustedRenderer(event);
    const win = getWindow();
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Browser IPC requires the main application frame');
    let value = hosts.get(win);
    if (!value) { value = new EmbeddedBrowserHost(win); hosts.set(win, value); }
    return value;
  };
  ipc.handle('browser:ensure', (e, input) => host(e).ensure(input));
  ipc.handle('browser:navigate', (e, id, url) => host(e).navigate(id, url));
  ipc.handle('browser:command', (e, id, command) => host(e).command(id, command));
  ipc.handle('browser:present', (e, id, bounds) => host(e).present(id, bounds));
  ipc.handle('browser:close', (e, id) => host(e).close(id));
  ipc.handle('browser:release', e => host(e).dispose());
}

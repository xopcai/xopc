import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ views: [] as any[], response: 0, profile: null as any }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Contents extends EventEmitter {
    url = ''; dead = false; guard = false;
    mainFrame = { url: 'http://localhost:5173/' };
    navigationHistory = { canGoBack: () => false, canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() };
    getURL() { return this.url; } getTitle() { return 'Page'; } isLoading() { return false; } isDestroyed() { return this.dead; }
    setAudioMuted = vi.fn(); setWindowOpenHandler = vi.fn(); reload = vi.fn(); stop = vi.fn(); focus = vi.fn(); send = vi.fn();
    loadURL = vi.fn(async (url: string) => { this.url = url; });
    close() {
      if (this.guard) { let leave = false; this.emit('will-prevent-unload', { preventDefault: () => { leave = true; } }); if (!leave) return; }
      this.dead = true; this.emit('destroyed');
    }
  }
  class View {
    webContents = new Contents(); setVisible = vi.fn(); setBounds = vi.fn(); setBackgroundColor = vi.fn();
    constructor(public options: any) { mocks.views.push(this); }
  }
  return { WebContentsView: View, BrowserWindow: {}, dialog: { showMessageBoxSync: () => mocks.response }, session: { fromPartition: vi.fn(() => mocks.profile) } };
});
import { EmbeddedBrowserHost, registerBrowserIpc } from '../browser-host';
import { browserHttpUrl, clipBrowserBounds, resolveBrowserInput } from '../url-policy';

let win: any;
beforeEach(() => {
  mocks.views = []; mocks.response = 0;
  mocks.profile = Object.assign(new EventEmitter(), { setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn(), setDevicePermissionHandler: vi.fn() });
  win = Object.assign(new EventEmitter(), { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, getContentSize: () => [1000, 800], webContents: Object.assign(new EventEmitter(), { getZoomFactor: () => 1, getURL: () => 'http://localhost:5173/', isDestroyed: () => false, mainFrame: {}, send: vi.fn(), focus: vi.fn() }), contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } });
});
const owner = (workspaceTabId = 'tab') => ({ workspaceTabId, scope: 'parent', identity: 'gateway:public-principal' });
describe('native browser host', () => {
  it('creates an isolated guest without any application preload and reuses only its exact tab', () => {
    const host = new EmbeddedBrowserHost(win), a = host.ensure(owner()), same = host.ensure(owner()), b = host.ensure(owner('other'));
    expect(same.id).toBe(a.id); expect(b.id).not.toBe(a.id);
    expect(mocks.views[0].options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false });
    expect(mocks.views[0].options.webPreferences.preload).toBeUndefined();
  });
  it('migrates a new-chat tab to its materialized conversation without recreating its native history', () => {
    const host = new EmbeddedBrowserHost(win);
    const a = host.ensure({ ...owner(), scope: 'new' });
    host.navigate(a.id, 'https://example.com/');
    const b = host.ensure(owner());
    expect(b.id).toBe(a.id); expect(b.scope).toBe('parent');
    expect(mocks.views).toHaveLength(1);
    expect(mocks.views[0].webContents.dead).toBe(false);
  });
  it('clips guest bounds, detaches on hide, and preserves its contents', () => {
    const host = new EmbeddedBrowserHost(win), a = host.ensure(owner());
    host.present(a.id, { x: 700, y: 60, width: 500, height: 900 });
    expect(mocks.views[0].setBounds).toHaveBeenLastCalledWith({ x: 700, y: 60, width: 300, height: 740 });
    host.present(a.id, null); expect(mocks.views[0].webContents.dead).toBe(false); expect(win.contentView.removeChildView).toHaveBeenCalled();
  });
  it('converts renderer CSS bounds to native DIP at application zoom', () => {
    win.webContents.getZoomFactor = () => 1.5;
    const host = new EmbeddedBrowserHost(win), a = host.ensure(owner());
    host.present(a.id, { x: 100, y: 60, width: 300, height: 200 });
    expect(mocks.views[0].setBounds).toHaveBeenLastCalledWith({ x: 150, y: 90, width: 450, height: 300 });
  });
  it('does not let an inactive tab hide the active tab', () => {
    const host = new EmbeddedBrowserHost(win), a = host.ensure(owner()), b = host.ensure(owner('b'));
    host.present(a.id, { x: 10, y: 10, width: 300, height: 300 }); host.present(b.id, null);
    expect(win.contentView.removeChildView).not.toHaveBeenCalled();
  });
  it('respects beforeunload cancellation and then removes the native view on confirmed close', async () => {
    const host = new EmbeddedBrowserHost(win), a = host.ensure(owner()); mocks.views[0].webContents.guard = true;
    host.present(a.id, { x: 0, y: 0, width: 300, height: 300 });
    expect(await host.close(a.id)).toBe(false); expect(mocks.views[0].webContents.dead).toBe(false);
    mocks.response = 1; expect(await host.close(a.id)).toBe(true); expect(win.contentView.removeChildView).toHaveBeenCalled();
    expect(() => host.command(a.id, 'reload')).toThrow('unavailable');
  });
  it('releases a view even when Electron clears its webContents getter before destroyed', async () => {
    const host = new EmbeddedBrowserHost(win), a = host.ensure(owner());
    const wc = mocks.views[0].webContents;
    wc.close = () => { mocks.views[0].webContents = undefined; wc.dead = true; wc.emit('destroyed'); };
    host.present(a.id, { x: 0, y: 0, width: 300, height: 300 });
    expect(await host.close(a.id)).toBe(true);
    expect(() => host.present(a.id, null)).not.toThrow();
    expect(win.contentView.removeChildView).toHaveBeenCalled();
  });
  it('denies script URLs and external protocol popups while permitting HTTP new tabs', () => {
    const host = new EmbeddedBrowserHost(win), a = host.ensure(owner());
    expect(() => host.navigate(a.id, 'javascript:alert(1)')).toThrow();
    const handle = mocks.views[0].webContents.setWindowOpenHandler.mock.calls[0][0];
    expect(handle({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
    handle({ url: 'https://example.com/?x=1#fragment' });
    expect(win.webContents.send).toHaveBeenCalledWith('browser:event', expect.objectContaining({ kind: 'popup', url: 'https://example.com/?x=1#fragment', scope: 'parent' }));
  });
  it('destroys old guests on identity change and host document reload', () => {
    const host = new EmbeddedBrowserHost(win); host.ensure(owner()); host.ensure({ ...owner('b'), identity: 'another-owner' });
    expect(mocks.views[0].webContents.dead).toBe(true);
    win.webContents.emit('did-start-navigation', {}, 'http://localhost:5173/', false, true);
    expect(mocks.views[1].webContents.dead).toBe(true);
    expect(mocks.profile.listenerCount('will-download')).toBe(0);
    expect(mocks.profile.setPermissionRequestHandler).toHaveBeenLastCalledWith(null);
  });
  it('rejects a guest or iframe even when it navigates to a loopback URL', () => {
    const handlers = new Map(); registerBrowserIpc({ handle: (name: string, fn: any) => handlers.set(name, fn) } as any, () => win);
    const guest = { getURL: () => 'http://localhost:5173/' };
    expect(() => handlers.get('browser:ensure')({ sender: guest, senderFrame: { url: 'http://localhost:5173/' } }, owner())).toThrow('main application frame');
    expect(() => handlers.get('browser:ensure')({ sender: win.webContents, senderFrame: {} }, owner())).toThrow('main application frame');
  });
});
describe('address policy', () => {
  it.each(['javascript:alert(1)', 'file:///tmp/test', 'data:text/html,test', 'https://user:password@example.com'])('rejects %s', input => expect(() => resolveBrowserInput(input)).toThrow());
  it('preserves full query/hash and handles localhost without search', () => {
    expect(resolveBrowserInput('localhost:3000/path?q=1#hash')).toBe('http://localhost:3000/path?q=1#hash');
    expect(resolveBrowserInput('example.com/path?q=1#hash')).toBe('https://example.com/path?q=1#hash');
    expect(resolveBrowserInput('a plain search')).toBeNull();
    expect(resolveBrowserInput('a plain search', 'bing')).toBe('https://www.bing.com/search?q=a%20plain%20search');
  });
  it('rejects non-finite bounds and invalid URL types', () => {
    expect(() => clipBrowserBounds({ x: NaN, y: 0, width: 1, height: 1 }, 100, 100)).toThrow();
    expect(() => browserHttpUrl(undefined as any)).toThrow();
  });
});

import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { BrowserWindow, session, type Session } from 'electron';
import type { BrowserControlError, BrowserControlResult } from '@xopcai/browser-control-contract';
import type { RemoteBrowserCommand } from '@xopcai/browser-control-contract/remote';

import { assertBrowserUrlAllowed } from '../../src/browser/url-policy.js';
import { verifyBrowserExpectation } from '../../src/browser/verification/expectation.js';
import { desktopBrowserDom, desktopBrowserObservation } from './browser-dom.js';
import type { DesktopBrowserBroker } from './browser-session.js';

type Tab = { id: string; window: BrowserWindow };
const failure = (code: BrowserControlError['code'], message: string): BrowserControlResult => ({ ok: false, error: { code, message } });

/** Lives only in the private Browser worker. Its in-memory partition has no shell cookies, preload, Node, IPC bridge or debugger port. */
export class DesktopBrowserWindowBroker implements DesktopBrowserBroker {
  private partition?: Session;
  private readonly namespace = '__xopc_private_' + randomUUID().replaceAll('-', '');
  private readonly tabs = new Map<string, Tab>();
  private active?: string;
  private owner?: string;
  private sessionId?: string;
  private closed = false;
  private blockedNavigation = false;
  constructor(private readonly options: { current(): boolean; privateHostAllowed?: boolean }) {}
  private allowed(url: string): boolean {
    try { assertBrowserUrlAllowed(url, { privateHostAllowed: this.options.privateHostAllowed }); return true; } catch { return false; }
  }
  private initialize(): void {
    if (this.partition) return;
    this.partition = session.fromPartition('xopc-remote-browser-' + randomUUID());
    this.partition.setPermissionCheckHandler(() => false);
    this.partition.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
    this.partition.on('will-download', event => event.preventDefault());
    this.partition.webRequest.onBeforeRequest((details, answer) => {
      const allowed = details.url === 'about:blank' || this.allowed(details.url);
      if (!allowed && details.resourceType === 'mainFrame') this.blockedNavigation = true;
      answer({ cancel: !allowed });
    });
  }
  private async create(): Promise<Tab> {
    this.initialize();
    if (this.tabs.size >= 4) throw new Error('DESKTOP_BROWSER_TAB_LIMIT');
    const window = new BrowserWindow({ width: 1280, height: 800, show: false, title: 'xopc · Authorized device browser',
      webPreferences: { session: this.partition, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
        webviewTag: false, devTools: false, safeDialogs: true, navigateOnDragDrop: false } });
    const tab = { id: randomUUID(), window }; this.tabs.set(tab.id, tab); this.active = tab.id;
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    const navigation = (event: Electron.Event, url: string) => {
      if (!this.allowed(url)) { this.blockedNavigation = true; event.preventDefault(); }
    };
    window.webContents.on('will-navigate', navigation); window.webContents.on('will-redirect', navigation);
    window.on('closed', () => { this.tabs.delete(tab.id); if (this.active === tab.id) this.active = this.tabs.keys().next().value; });
    await window.loadURL('about:blank');
    if (this.closed || !this.options.current()) { window.destroy(); throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID'); }
    window.show(); return tab;
  }
  metadata() {
    return [...this.tabs.values()].map(tab => ({ id: tab.id, url: tab.window.webContents.getURL().slice(0, 4096),
      title: tab.window.getTitle().slice(0, 4096), active: tab.id === this.active }));
  }
  private async dom(tab: Tab, command: Parameters<typeof desktopBrowserDom>[1]) {
    if (this.closed || !this.options.current() || tab.window.isDestroyed()) throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID');
    return tab.window.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `(${desktopBrowserDom.toString()})(${JSON.stringify(this.namespace + tab.id)},${JSON.stringify(command)})` }]) as Promise<ReturnType<typeof desktopBrowserDom>>;
  }
  async execute(command: RemoteBrowserCommand, signal: AbortSignal): ReturnType<DesktopBrowserBroker['execute']> {
    signal.throwIfAborted();
    if (this.closed || !this.options.current()) throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID');
    if (this.owner && this.owner !== command.owner || this.sessionId && this.sessionId !== command.sessionId) throw new Error('DESKTOP_BROWSER_OWNER_MISMATCH');
    this.owner ??= command.owner; this.sessionId ??= command.sessionId;
    const abort = () => { void this.dispose(); }; signal.addEventListener('abort', abort, { once: true });
    const started = Date.now(), input = command.input;
    try {
      if (input.action === 'close') {
        const result = await this.dispose();
        if (!result.confirmed) throw new Error('DESKTOP_BROWSER_STOP_UNCONFIRMED');
        return { dispatch: 'completed', result: { ok: true, receipt: { action: 'close', risk: 'read', durationMs: Date.now() - started, verified: true } } };
      }
      if ((input.action === 'navigate' || input.action === 'tabs' && input.operation === 'create') && input.url && !this.allowed(input.url)) {
        return { dispatch: 'notStarted', result: failure('BLOCKED_URL', 'Device Browser URL policy rejected this destination.') };
      }
      let tab = this.active ? this.tabs.get(this.active) : undefined;
      if (!tab) tab = await this.create();
      let raw: Awaited<ReturnType<typeof this.dom>> = {};
      if (input.action === 'tabs') {
        if (input.operation === 'create') tab = await this.create();
        else if (input.operation !== 'list') {
          const selected = input.tabId && this.tabs.get(input.tabId);
          if (!selected) return { dispatch: 'notStarted', result: failure('TARGET_NOT_FOUND', 'This tab does not belong to the device browser session.') };
          if (input.operation === 'close') { selected.window.destroy(); tab = this.active ? this.tabs.get(this.active) : undefined; }
          else { this.active = selected.id; selected.window.show(); tab = selected; }
        }
        if (input.operation === 'create' && input.url && tab) await tab.window.loadURL(input.url);
        return { dispatch: 'completed', result: { ok: true, receipt: { action: 'tabs', risk: 'read', durationMs: Date.now() - started, verified: true, tabs: this.metadata() } } };
      }
      this.blockedNavigation = false;
      if (input.action === 'navigate') await tab.window.loadURL(input.url);
      else if (input.action !== 'observe') {
        if (input.action === 'press' && !/^(Enter|Tab|Escape|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Space|[a-zA-Z0-9])$/.test(input.key)) {
          return { dispatch: 'notStarted', result: failure('INVALID_INPUT', 'Only one supported device-browser key is accepted.') };
        }
        const resolvedObservation = input.action === 'resolve' ? desktopBrowserObservation(command.sessionId, tab.id, await this.dom(tab, { action: 'snapshot' })) : undefined;
        raw = await this.dom(tab, input);
        if (input.action === 'wait') {
          const until = performance.now() + Math.min(5000, input.timeoutMs ?? 5000);
          while (raw.error === 'TIMEOUT' && performance.now() < until) { await delay(50, undefined, { signal }); raw = await this.dom(tab, input); }
        }
        if (raw.error) return { dispatch: 'notStarted', result: failure(raw.error as BrowserControlError['code'], 'Device page state did not permit this action.') };
        if (resolvedObservation) return { dispatch: 'completed', result: { ok: true, receipt: { action: 'resolve', risk: 'read',
          durationMs: Date.now() - started, verified: true, observation: resolvedObservation, outputs: raw.outputs } } };
        if (input.action === 'press') {
          tab.window.webContents.sendInputEvent({ type: 'keyDown', keyCode: input.key });
          tab.window.webContents.sendInputEvent({ type: 'keyUp', keyCode: input.key });
        }
      }
      signal.throwIfAborted();
      const observation = desktopBrowserObservation(command.sessionId, tab.id, await this.dom(tab, { action: 'snapshot' }));
      if (this.blockedNavigation || observation.url !== 'about:blank' && !this.allowed(observation.url)) throw new Error('DESKTOP_BROWSER_NAVIGATION_BLOCKED');
      const expected = 'expect' in input ? verifyBrowserExpectation(input.expect, observation) : null;
      let frame: { bytes: Uint8Array; mimeType: 'image/jpeg' } | undefined;
      if (input.action === 'observe' && (input.visual === 'always' || input.visual !== 'never' && !observation.nodes.length)) {
        const image = await tab.window.webContents.capturePage();
        frame = { bytes: image.resize({ width: Math.min(1280, image.getSize().width) }).toJPEG(70), mimeType: 'image/jpeg' };
      }
      return { dispatch: 'completed', result: expected ? { ok: false, error: { code: 'EXPECTATION_FAILED', message: expected, observation } }
        : { ok: true, receipt: { action: input.action, risk: input.action === 'observe' || input.action === 'resolve' || input.action === 'navigate' ? 'read' : 'draft',
          durationMs: Date.now() - started, verified: true, observation,
          ...(['click', 'fill', 'select', 'check', 'press'].includes(input.action) ? { businessOutcome: 'expect' in input && input.expect ? 'verified' as const : 'unknown' as const } : {}),
          ...(raw.outputs ? { outputs: raw.outputs } : {}) } }, ...(frame ? { frame } : {}) };
    } finally { signal.removeEventListener('abort', abort); }
  }
  async dispose(): Promise<{ confirmed: boolean }> {
    this.closed = true;
    const windows = [...this.tabs.values()].map(tab => tab.window);
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    const confirmed = windows.every(window => window.isDestroyed());
    if (confirmed) { this.tabs.clear(); this.active = undefined; await this.partition?.closeAllConnections(); await this.partition?.clearStorageData(); }
    return { confirmed };
  }
}

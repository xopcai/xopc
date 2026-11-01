import { readFileSync } from 'node:fs';

import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(new URL('../gateway/gateway-connections.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../gateway/gateway-connections.js', import.meta.url), 'utf8');
const profile = (id = 'server-a') => ({ id, name: id === 'server-a' ? '开发服务器' : '另一服务器', origin: `https://${id}.example.com`, transport: 'direct', hasCredential: true });
const identity = { gatewayId: 'gateway-a', publicKey: 'verified-key' };
const windows: JSDOM[] = [];
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });
async function fixture(extra: Record<string, unknown> = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://fixture.invalid' }); windows.push(dom);
  const state = { epoch: 0, status: 'unselected', mode: 'remote', profiles: [profile()], desktop: {}, ...extra } as Record<string, any>;
  const snapshot = () => structuredClone(state);
  const result = () => ({ ok: true, snapshot: snapshot() });
  const api: Record<string, any> = { snapshot: vi.fn(async () => snapshot()), useLocal: vi.fn(), quit: vi.fn() };
  for (const name of ['enrollDesktop', 'checkDesktop', 'disableDesktop', 'reenrollDesktop', 'startObservation', 'startScreenObservation', 'startExecution', 'startWorkspace', 'startContainer', 'startTerminal', 'startComputer', 'startBrowser', 'flushStopReceipts', 'listContainers', 'listOperations', 'reviewOperation', 'listLocalOperations', 'reviewLocalOperation', 'stopExecution', 'stopObservation', 'remove']) api[name] = vi.fn(async () => result());
  api.save = vi.fn(async (_epoch, input) => { state.profiles.push({ ...profile('new-server'), name: input.name, origin: input.origin, transport: input.transport, id: 'new-server', hasCredential: Boolean(input.credential) }); state.epoch++; return result(); });
  api.connect = vi.fn(async (_epoch, id) => { state.epoch++; state.selectedId = id; state.profiles = state.profiles.map(p => p.id === id ? { ...p, identity } : p); return result(); });
  api.select = vi.fn(async (_epoch, id) => { state.epoch++; state.selectedId = id; return result(); });
  Object.assign(dom.window, { gatewayConnections: api });
  Object.assign(dom.window.HTMLDialogElement.prototype, { showModal() { this.setAttribute('open', ''); }, close() { this.removeAttribute('open'); } });
  dom.window.eval(script);
  await Promise.resolve();
  const get = (id: string) => dom.window.document.getElementById(id)!;
  const click = (selector: string) => (dom.window.document.querySelector(selector)! as HTMLButtonElement).click();
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const refresh = async () => { dom.window.dispatchEvent(new dom.window.Event('focus')); await settle(); };
  const submit = (connect = false) => get('profile-form').dispatchEvent(new dom.window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: get('profile-form').querySelector(`button[value="${connect ? 'connect' : 'save'}"]`) as HTMLButtonElement }));
  return { dom, state, api, get, click, settle, refresh, submit };
}

describe('standalone Gateway connection settings', () => {
  it('starts with the list and no network/device activation or plaintext credentials', async () => {
    const f = await fixture();
    expect(f.get('connection-list').hidden).toBe(false);
    expect(f.get('profile-dialog').hasAttribute('open')).toBe(false);
    expect(f.get('connection-detail').hidden).toBe(true);
    expect(f.api.connect).not.toHaveBeenCalled(); expect(f.api.select).not.toHaveBeenCalled(); expect(f.api.enrollDesktop).not.toHaveBeenCalled();
    expect(f.dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("connect-src 'none'");
  });
  it('adds a server with an optional derived name, only saves explicitly, and clears credentials', async () => {
    const f = await fixture(); f.click('#add-server');
    (f.get('origin') as HTMLInputElement).value = 'https://saved.example.com';
    (f.get('credential') as HTMLInputElement).value = 'test-only-secret'; f.submit(); await f.settle();
    expect(f.api.save).toHaveBeenCalledWith(0, { name: 'saved.example.com', origin: 'https://saved.example.com', transport: 'direct', credential: 'test-only-secret' });
    expect(f.api.connect).not.toHaveBeenCalled(); expect((f.get('credential') as HTMLInputElement).value).toBe('');
    expect(f.get('profile-dialog').hasAttribute('open')).toBe(false);
    expect(f.dom.window.document.body.textContent).not.toContain('test-only-secret');
  });
  it('connects only after save succeeds, using the returned profile and current epoch', async () => {
    const f = await fixture(); f.click('#add-server'); (f.get('origin') as HTMLInputElement).value = 'https://saved.example.com'; f.submit(true); await f.settle();
    expect(f.api.connect).toHaveBeenCalledWith(1, 'new-server'); expect(f.get('connection-detail').hidden).toBe(false);
    expect(f.api.enrollDesktop).not.toHaveBeenCalled(); expect(f.api.startExecution).not.toHaveBeenCalled();
    expect(f.get('detail-identity').textContent).toContain('身份已核验'); expect(f.get('detail-state').textContent).not.toContain('在线');
  });
  it('locks the submitted form until the save finishes, including Escape and cancellation', async () => {
    const f = await fixture(); let reject!: (value: unknown) => void;
    f.api.save.mockImplementation(() => new Promise(resolve => { reject = resolve; }));
    f.click('#add-server'); (f.get('origin') as HTMLInputElement).value = 'https://pending.example.com'; f.submit(true);
    expect((f.get('origin') as HTMLInputElement).disabled).toBe(true); expect((f.get('profile-cancel') as HTMLButtonElement).disabled).toBe(true);
    const cancel = new f.dom.window.Event('cancel', { cancelable: true }); f.get('profile-dialog').dispatchEvent(cancel); expect(cancel.defaultPrevented).toBe(true);
    reject({ ok: false, error: 'SECURE_STORAGE_UNAVAILABLE' }); await f.settle();
    expect((f.get('profile-cancel') as HTMLButtonElement).disabled).toBe(false); expect(f.api.connect).not.toHaveBeenCalled();
  });
  it('keeps failed save feedback inside the open dialog and preserves the editable address', async () => {
    const f = await fixture(); f.api.save.mockResolvedValue({ ok: false, error: 'SECURE_STORAGE_UNAVAILABLE' }); f.click('#add-server');
    (f.get('origin') as HTMLInputElement).value = 'https://saved.example.com'; (f.get('credential') as HTMLInputElement).value = 'secret'; f.submit(true); await f.settle();
    expect(f.get('profile-dialog').hasAttribute('open')).toBe(true); expect(f.get('profile-error').textContent).toContain('系统安全存储不可用');
    expect((f.get('origin') as HTMLInputElement).value).toBe('https://saved.example.com'); expect((f.get('credential') as HTMLInputElement).value).toBe(''); expect(f.api.connect).not.toHaveBeenCalled();
  });
  it('keeps a saved profile after connection failure without implicitly enrolling or granting access', async () => {
    const f = await fixture(); f.api.connect.mockResolvedValue({ ok: false, error: 'GATEWAY_AUTH_FAILED' });
    f.click('#add-server'); (f.get('origin') as HTMLInputElement).value = 'https://saved.example.com'; f.submit(true); await f.settle();
    expect(f.state.profiles).toHaveLength(2); expect(f.get('error').textContent).toContain('登录凭据无效'); expect(f.api.enrollDesktop).not.toHaveBeenCalled();
  });
  it('shows details without selecting a profile, and scopes authorization to the selected verified device', async () => {
    const f = await fixture({ profiles: [{ ...profile(), identity }, profile('server-b')], selectedId: 'server-a', desktop: { 'server-a': { state: 'registered', workspaceExecution: true } } });
    f.click('[data-desktop="execute-workspace"]'); await f.settle(); expect(f.api.startWorkspace).toHaveBeenCalledWith(0, 'server-a');
    f.click('#back'); (f.get('profiles').querySelectorAll('.row-actions .text-button')[1] as HTMLButtonElement).click();
    expect(f.api.select).not.toHaveBeenCalled(); expect(f.get('desktop-actions').querySelector('.capabilities')?.hasAttribute('hidden')).toBe(true);
    expect((f.get('desktop-actions').querySelector('[data-desktop="enroll"]') as HTMLButtonElement).disabled).toBe(true);
  });
  it('preserves expanded groups and keyboard focus during status polling without reauthorizing', async () => {
    const f = await fixture({ profiles: [{ ...profile(), identity }], selectedId: 'server-a', desktop: { 'server-a': { state: 'registered', workspaceExecution: true } } });
    const group = f.get('desktop-actions').querySelectorAll('details')[1]; group.open = true;
    (f.get('desktop-actions').querySelector('[data-desktop="execute-workspace"]') as HTMLButtonElement).focus();
    f.state.desktop['server-a'].operationReview = true; await f.refresh();
    expect(f.get('desktop-actions').querySelectorAll('details')[1].open).toBe(true);
    expect((f.dom.window.document.activeElement as HTMLElement).dataset.desktop).toBe('execute-workspace'); expect(f.api.startWorkspace).not.toHaveBeenCalled();
  });
  it('does not let an older snapshot overwrite a newer selection', async () => {
    const f = await fixture({ epoch: 4, profiles: [{ ...profile(), identity }], selectedId: 'server-a' });
    f.api.snapshot.mockResolvedValue({ epoch: 2, status: 'unselected', profiles: [], desktop: {} }); await f.refresh();
    expect(f.get('selection-status').textContent).toContain('开发服务器'); expect(f.get('profiles').textContent).toContain('开发服务器');
  });
  it('keeps stop accessible outside collapsed settings, and never treats a request as a confirmed stop', async () => {
    const f = await fixture({ execution: { state: 'online', resultUnknown: false } });
    let finish!: (value: unknown) => void; f.api.stopExecution.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    f.click('#execution-stop'); expect(f.get('execution-status').textContent).toBe('已请求停止，正在核实。'); await f.refresh();
    expect(f.get('execution-section').hidden).toBe(false); expect(f.get('execution-status').textContent).toBe('已请求停止，正在核实。');
    finish({ ok: false, error: 'DESKTOP_EXECUTION_STOP_UNCONFIRMED', snapshot: { ...f.state, execution: { state: 'stop-unconfirmed', resultUnknown: true } } }); await f.settle();
    expect(f.get('execution-status').textContent).toContain('停止尚未确认'); expect(f.get('recovery').hasAttribute('open')).toBe(true);
    expect((f.get('execution-stop') as HTMLButtonElement).disabled).toBe(false);
  });
  it('updates login with its captured binding and clears secrets when cancelled or rejected', async () => {
    const f = await fixture(); f.click('[data-login="server-a"]'); (f.get('login-credential') as HTMLInputElement).value = 'not-for-logs';
    f.state.epoch = 3; await f.refresh(); f.api.save.mockResolvedValue({ ok: false, error: 'STALE_CONNECTION_EPOCH' });
    f.get('login-update').dispatchEvent(new f.dom.window.Event('submit', { bubbles: true, cancelable: true })); await f.settle();
    expect(f.api.save).toHaveBeenCalledWith(0, expect.objectContaining({ id: 'server-a', origin: profile().origin, credential: 'not-for-logs' }));
    expect(f.get('login-dialog').hasAttribute('open')).toBe(true); expect((f.get('login-credential') as HTMLInputElement).value).toBe('');
    f.click('#login-cancel'); expect(f.get('login-dialog').hasAttribute('open')).toBe(false);
  });
  it('renders untrusted profile names as text and preserves the local-mode handoff', async () => {
    const f = await fixture({ profiles: [{ ...profile(), name: '<img src=x onerror=alert(1)>' }] });
    expect(f.get('profiles').querySelector('img')).toBeNull(); expect(f.get('profiles').textContent).toContain('<img src=x onerror=alert(1)>');
    f.click('#local'); expect(f.api.useLocal).toHaveBeenCalledOnce(); expect(f.api.connect).not.toHaveBeenCalled();
  });
});

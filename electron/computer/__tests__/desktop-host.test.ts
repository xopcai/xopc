import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeEndpointBinding } from '@xopcai/realtime-client';

const state = vi.hoisted(() => ({
  saved: undefined as string | undefined,
  visible: true,
  dialog: vi.fn(),
  write: vi.fn(),
  atomicWrite: vi.fn(),
  clients: [] as Array<{ binding: RealtimeEndpointBinding; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>,
}));
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/fixture', getPath: () => '/fixture', getVersion: () => 'test' },
  clipboard: {}, shell: {}, dialog: { showMessageBox: state.dialog },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  systemPreferences: { isTrustedAccessibilityClient: () => true, getMediaAccessStatus: () => 'granted' },
}));
vi.mock('node:fs/promises', () => ({
  readFile: async () => { if (state.saved) return state.saved; throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
  writeFile: state.write, stat: vi.fn(),
}));
vi.mock('../../../src/infra/write-file-atomic.js', () => ({ writeTextAtomic: state.atomicWrite }));
vi.mock('../../ipc/system-settings-ipc.js', () => ({ showEndpointNotification: vi.fn() }));
vi.mock('../../ipc/file-ipc.js', () => ({ MIME_TYPE_BY_EXTENSION: {} }));
vi.mock('../cua-driver.js', () => ({ CuaComputerDriver: class { async stop() {} } }));
vi.mock('@xopcai/realtime-client', () => ({ RealtimeClient: class {
  binding!: RealtimeEndpointBinding;
  connect = vi.fn();
  disconnect = vi.fn(() => this.binding.onDisconnected?.());
  constructor() { state.clients.push(this); }
  setEndpoint(binding: RealtimeEndpointBinding) { this.binding = binding; }
} }));

import { DesktopEndpointHost } from '../desktop-host.js';

const hosts: DesktopEndpointHost[] = [];
function host() {
  const value = new DesktopEndpointHost({ connection: () => ({ port: 1, token: 'fixture' }), window: () => ({
    isDestroyed: () => false, isVisible: () => state.visible, isMinimized: () => false, isFocused: () => true,
  }) as any });
  hosts.push(value); return value;
}
const revoked = () => Response.json({ error: { code: 'PRINCIPAL_REVOKED' } }, { status: 403 });
beforeEach(() => {
  state.saved = undefined; state.visible = true; state.clients = [];
  state.write.mockImplementation(async (_path, data) => { state.saved = data; });
  state.atomicWrite.mockImplementation(async (_path, data) => { state.saved = data; });
  state.dialog.mockResolvedValue({ response: 0 });
});
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(h => h.close()));
  vi.unstubAllGlobals(); vi.resetAllMocks();
});

describe('desktop principal reenrollment', () => {
  it('stays revoked until explicit native consent, then replaces the identity and publishes a new claim', async () => {
    const fetch = vi.fn().mockImplementation(revoked); vi.stubGlobal('fetch', fetch);
    const desktop = host(); await desktop.start();
    const previous = JSON.parse(state.saved!);
    expect(desktop.snapshot()).toMatchObject({ connected: false, reenrollmentRequired: true });
    await desktop.start();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.dialog).not.toHaveBeenCalled();
    let decide!: (answer: { response: number }) => void;
    state.dialog.mockImplementation(() => new Promise(resolve => { decide = resolve; }));
    const pending = desktop.reenroll();
    await desktop.reenroll();
    expect(state.dialog).toHaveBeenCalledTimes(1);
    expect(state.dialog.mock.calls[0][1]).toMatchObject({ defaultId: 0, cancelId: 0 });
    expect(state.atomicWrite).not.toHaveBeenCalled();
    fetch.mockImplementation(async () => Response.json({ ok: true }));
    decide({ response: 1 }); await pending;
    const next = JSON.parse(state.saved!);
    expect(next.principalId).not.toBe(previous.principalId);
    expect(next.publicKey).not.toBe(previous.publicKey);
    expect(state.atomicWrite).toHaveBeenCalledWith('/fixture/desktop-endpoint-identity.json', expect.any(String), { mode: 0o600 });
    const client = state.clients[0];
    const hello = await client.binding.createHello();
    expect(hello.principalId).toBe(next.principalId);
    client.binding.onReady!({ endpointId: hello.endpointId, turnToken: 'new-turn-token' } as any);
    expect(desktop.snapshot()).toMatchObject({ connected: true, reenrollmentRequired: false, claim: { token: 'new-turn-token' }, session: { status: 'idle' } });
  });

  it('keeps the revoked key after cancellation and allows an explicit retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(revoked));
    const desktop = host(); await desktop.start(); const previous = state.saved;
    await desktop.reenroll(); await desktop.reenroll();
    expect(state.dialog).toHaveBeenCalledTimes(2);
    expect(state.atomicWrite).not.toHaveBeenCalled();
    expect(state.saved).toBe(previous);
    expect(desktop.snapshot().reenrollmentRequired).toBe(true);
    expect(state.clients).toHaveLength(0);
  });

  it('detects revocation on reconnect and stops the old connection before reenrollment', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal('fetch', fetch);
    const desktop = host(); await desktop.start(); const client = state.clients[0];
    client.binding.onReady!({ endpointId: 'old', turnToken: 'old-turn-token' } as any);
    expect(desktop.snapshot().connected).toBe(true);
    fetch.mockImplementation(revoked);
    await expect(client.binding.createHello()).rejects.toThrow('403');
    expect(client.disconnect).toHaveBeenCalledOnce();
    expect(desktop.snapshot()).toMatchObject({ connected: false, reenrollmentRequired: true });
    client.binding.onReady!({ endpointId: 'old', turnToken: 'late-turn-token' } as any);
    expect(desktop.snapshot().claim).toBeUndefined();
  });

  it.each(['cancelled-on-close', 'hidden'] as const)('never rotates after %s during confirmation', async reason => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(revoked));
    const desktop = host(); await desktop.start();
    let decide!: (answer: { response: number }) => void;
    state.dialog.mockImplementation(() => new Promise(resolve => { decide = resolve; }));
    const pending = desktop.reenroll();
    if (reason === 'hidden') state.visible = false; else await desktop.close();
    decide({ response: 1 }); await pending;
    expect(state.atomicWrite).not.toHaveBeenCalled();
    expect(state.clients).toHaveLength(0);
  });

  it('does not offer identity rotation for an unrelated authorization failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 403 })));
    const desktop = host(); await desktop.start(); await desktop.reenroll();
    expect(desktop.snapshot().reenrollmentRequired).toBe(false);
    expect(state.dialog).not.toHaveBeenCalled();
    expect(state.atomicWrite).not.toHaveBeenCalled();
  });
});

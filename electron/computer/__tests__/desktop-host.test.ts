import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeEndpointBinding } from '@xopcai/realtime-client';

const state = vi.hoisted(() => ({
  saved: undefined as string | undefined,
  visible: true,
  language: 'zh' as 'en' | 'zh',
  dialog: vi.fn(),
  write: vi.fn(),
  atomicWrite: vi.fn(),
  readControl: vi.fn(() => false),
  writeControl: vi.fn(),
  compatibility: vi.fn(),
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
vi.mock('../control-preferences.js', () => ({ readFullControl: state.readControl, writeFullControl: state.writeControl }));
vi.mock('../../ipc/system-settings-ipc.js', () => ({ showEndpointNotification: vi.fn(), getElectronShellLanguage: () => state.language }));
vi.mock('../../ipc/file-ipc.js', () => ({ MIME_TYPE_BY_EXTENSION: {} }));
vi.mock('../cua-driver.js', () => ({ CuaComputerDriver: class { async stop() {} } }));
vi.mock('../../gateway-compatibility.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../gateway-compatibility.js')>(),
  assertGatewayCompatibility: state.compatibility,
}));
vi.mock('@xopcai/realtime-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@xopcai/realtime-client')>(), RealtimeClient: class {
  binding!: RealtimeEndpointBinding;
  connect = vi.fn();
  disconnect = vi.fn(() => this.binding.onDisconnected?.());
  constructor() { state.clients.push(this); }
  setEndpoint(binding: RealtimeEndpointBinding) { this.binding = binding; }
} }));

import { DesktopEndpointHost, resolveComputerDriverPath } from '../desktop-host.js';
import { RealtimeConnectionError } from '@xopcai/realtime-client';

describe('computer driver paths', () => {
  it('resolves development cache relative to the bundled main entry, not app.getAppPath or cwd', () => {
    expect(resolveComputerDriverPath({ packaged: false, resourcesPath: '/electron/Resources', mainDir: '/workspace/out/main' }))
      .toBe('/workspace/.cache/computer-driver/0.28.2/cua-driver');
  });

  it('resolves packaged resources outside app.asar, independent of the development cache', () => {
    expect(resolveComputerDriverPath({ packaged: true, resourcesPath: '/Applications/xopc.app/Contents/Resources',
      mainDir: '/Applications/xopc.app/Contents/Resources/app.asar/out/main' }))
      .toBe('/Applications/xopc.app/Contents/Resources/bin/cua-driver');
  });
});

const hosts: DesktopEndpointHost[] = [];
function host() {
  const value = new DesktopEndpointHost({ connection: () => ({ port: 1, token: 'fixture' }), window: () => ({
    isDestroyed: () => false, isVisible: () => state.visible, isMinimized: () => false, isFocused: () => true,
  }) as any });
  hosts.push(value); return value;
}
const revoked = () => Response.json({ error: { code: 'PRINCIPAL_REVOKED' } }, { status: 403 });
beforeEach(() => {
  state.compatibility.mockResolvedValue(undefined);
  state.language = 'zh';
  state.readControl.mockReturnValue(false);
  state.saved = undefined; state.visible = true; state.clients = [];
  state.write.mockImplementation(async (_path, data) => { state.saved = data; });
  state.atomicWrite.mockImplementation(async (_path, data) => { state.saved = data; });
  state.dialog.mockResolvedValue({ response: 0 });
});
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(h => h.close()));
  vi.unstubAllGlobals(); vi.resetAllMocks();
});

describe('local full control', () => {
  it('reports incompatible gateways without registering or endlessly retrying', async () => {
    vi.useFakeTimers();
    state.compatibility.mockRejectedValue(new RealtimeConnectionError('GATEWAY_PROTOCOL_INCOMPATIBLE', false));
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    try {
      const desktop = host();
      await desktop.start();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(desktop.snapshot().error).toContain('版本不兼容');
      expect(state.compatibility).toHaveBeenCalledTimes(1);
      expect(request).not.toHaveBeenCalled();
      expect(state.clients).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });
  it('uses the current app language for each dialog without changing confirmation defaults', async () => {
    const desktop = host();
    await desktop.setFullControl(true);
    expect(state.dialog.mock.lastCall?.[1]).toMatchObject({ message: '允许 xopc 完全控制应用？', buttons: ['取消', '开启完全控制'], defaultId: 0, cancelId: 0 });
    expect(state.dialog.mock.lastCall?.[1].detail).not.toContain('Screenshots');
    state.language = 'en';
    await desktop.setFullControl(true);
    expect(state.dialog.mock.lastCall?.[1]).toMatchObject({ message: 'Allow xopc full control of apps?', buttons: ['Cancel', 'Enable full control'], defaultId: 0, cancelId: 0 });
    expect(state.dialog.mock.lastCall?.[1].detail).not.toMatch(/[\u4e00-\u9fff]/);
    expect(state.writeControl).not.toHaveBeenCalled();
  });
  it('requires a local opt-in, persists it and disables without another dialog', async () => {
    const desktop = host();
    expect(desktop.snapshot().fullControl).toBe(false);
    await desktop.setFullControl(true);
    expect(desktop.snapshot().fullControl).toBe(false);
    expect(state.writeControl).not.toHaveBeenCalled();
    state.dialog.mockResolvedValue({ response: 1 });
    await desktop.setFullControl(true);
    expect(desktop.snapshot().fullControl).toBe(true);
    expect(state.writeControl).toHaveBeenLastCalledWith('/fixture/computer-control-consent', true);
    const dialogs = state.dialog.mock.calls.length;
    await desktop.setFullControl(false);
    expect(desktop.snapshot().fullControl).toBe(false);
    expect(state.writeControl).toHaveBeenLastCalledWith('/fixture/computer-control-consent', false);
    expect(state.dialog).toHaveBeenCalledTimes(dialogs);
  });
  it('restores local consent and latches emergency stop until manual resume', async () => {
    state.readControl.mockReturnValue(true);
    const desktop = host();
    expect(desktop.snapshot().fullControl).toBe(true);
    await desktop.stopControl();
    expect(desktop.snapshot().controlPaused).toBe(true);
    await expect(desktop.broker.command({ op: 'open', sessionId: 's', owner: 'o', appRef: 'fixture', mode: 'control', prepare: false, model: {
      modelRef: 'ali/gui', profile: 'gui-plus-2026-02-26', origin: 'https://example.com', runtimeLocation: 'local',
    } })).rejects.toThrow('LOCAL_UI_REQUIRED');
    desktop.resumeControl();
    expect(desktop.snapshot()).toMatchObject({ controlPaused: false, fullControl: true });
    expect(state.dialog).not.toHaveBeenCalled();
  });
  it('rejects invalid or hidden-window mode changes', async () => {
    const desktop = host();
    await expect(desktop.setFullControl('true')).rejects.toThrow('Invalid');
    state.visible = false;
    await expect(desktop.setFullControl(true)).rejects.toThrow('local window');
    expect(state.writeControl).not.toHaveBeenCalled();
  });
  it('does not enable from a late confirmation after emergency stop', async () => {
    const desktop = host();
    let confirm!: (value: { response: number }) => void;
    state.dialog.mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
    const pending = desktop.setFullControl(true);
    await desktop.stopControl(); confirm({ response: 1 }); await pending;
    expect(desktop.snapshot()).toMatchObject({ fullControl: false, controlPaused: true });
    expect(state.writeControl).not.toHaveBeenCalled();
  });
  it('fails closed when saving consent fails', async () => {
    const desktop = host(); state.dialog.mockResolvedValue({ response: 1 });
    state.writeControl.mockImplementationOnce(() => { throw new Error('disk full'); });
    await expect(desktop.setFullControl(true)).rejects.toThrow('disk full');
    expect(desktop.snapshot().fullControl).toBe(false);
  });
  it('persists disabling before an emergency stop can interrupt driver cleanup', async () => {
    state.readControl.mockReturnValue(true);
    const desktop = host();
    let finish!: () => void;
    vi.spyOn(desktop.broker, 'stop').mockResolvedValue(undefined)
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const disabling = desktop.setFullControl(false);
    expect(state.writeControl).toHaveBeenCalledWith('/fixture/computer-control-consent', false);
    await desktop.stopControl(); finish(); await disabling;
    expect(desktop.snapshot()).toMatchObject({ fullControl: false, controlPaused: true });
  });
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

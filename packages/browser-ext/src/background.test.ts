import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readProfile: vi.fn(),
  autoConnectLocalGateway: vi.fn(),
  isAutoConnectEnabled: vi.fn(),
  registerBrowserEndpoint: vi.fn(),
  getAccessProfile: vi.fn(),
  gatewayFetch: vi.fn(),
  clients: [] as Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; endpoint?: any }>,
}));

vi.mock('./sidepanel/auth', () => ({ ...mocks, createBrowserEndpointHello: vi.fn(), createBrowserRequestProof: vi.fn() }));
vi.mock('./cdp', () => ({ isControlPaused: vi.fn(), resumeControl: vi.fn() }));
vi.mock('./controller', () => ({ executeBrowserCommand: vi.fn() }));
vi.mock('./sidepanel/page-context', () => ({ captureContextMenuSelection: vi.fn(), PENDING_CONTEXT_KEY: 'context' }));
vi.mock('./i18n', () => ({ t: (key: string) => key }));
vi.mock('./logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }));
vi.mock('@xopcai/endpoint-tools-client', () => ({
  EndpointToolRegistry: class { descriptors() { return []; } },
  EndpointToolHostController: class { connect() {} disconnect() {} },
  EndpointContextPublisher: class { start() {} stop() {} tick() {} },
}));
vi.mock('@xopcai/realtime-client', () => ({
  RealtimeClient: class {
    connect = vi.fn();
    disconnect = vi.fn();
    endpoint?: any;
    constructor() { mocks.clients.push(this); }
    setEndpoint(endpoint: any) { this.endpoint = endpoint; }
  },
}));

const profile = { gatewayId: 'gateway', deviceId: 'device', gatewayPublicKey: 'key', gatewayUrl: 'http://127.0.0.1:18790' };
let alarmListener: (alarm: { name: string }) => void;
let storageListener: (changes: Record<string, any>, area: string) => void;
let createAlarm: ReturnType<typeof vi.fn>;
let clearAlarm: ReturnType<typeof vi.fn>;

async function settle() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.clients.length = 0;
  mocks.readProfile.mockResolvedValue(profile);
  mocks.autoConnectLocalGateway.mockResolvedValue(profile);
  mocks.isAutoConnectEnabled.mockResolvedValue(true);
  mocks.getAccessProfile.mockResolvedValue(profile);
  mocks.gatewayFetch.mockResolvedValue({ ok: true, json: async () => ({ payload: {} }) });
  createAlarm = vi.fn().mockResolvedValue(undefined);
  clearAlarm = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('chrome', {
    runtime: { id: 'extension', onMessage: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() }, sendMessage: vi.fn().mockResolvedValue(undefined) },
    sidePanel: { setPanelBehavior: vi.fn().mockResolvedValue(undefined) },
    contextMenus: { onClicked: { addListener: vi.fn() } },
    alarms: { get: vi.fn().mockResolvedValue(undefined), create: createAlarm, clear: clearAlarm,
      onAlarm: { addListener: (listener: typeof alarmListener) => { alarmListener = listener; } } },
    storage: { local: { get: vi.fn().mockResolvedValue({ 'xopc.browser.background-client-id': 'client' }) },
      onChanged: { addListener: (listener: typeof storageListener) => { storageListener = listener; } } },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('background browser connection recovery', () => {
  it('enrolls and connects locally without opening the side panel', async () => {
    mocks.readProfile.mockResolvedValue(undefined);
    await import('./background');
    await settle();
    expect(mocks.autoConnectLocalGateway).toHaveBeenCalledOnce();
    expect(mocks.clients[0]?.connect).toHaveBeenCalledOnce();
    expect(createAlarm).toHaveBeenCalledWith('xopc.browser.reconnect', { delayInMinutes: 0.5, periodInMinutes: 0.5 });
  });

  it('retries discovery when the Gateway starts after Chrome', async () => {
    mocks.readProfile.mockResolvedValue(undefined);
    mocks.autoConnectLocalGateway.mockResolvedValueOnce(undefined);
    await import('./background');
    await settle();
    expect(mocks.clients).toHaveLength(0);
    alarmListener({ name: 'xopc.browser.reconnect' });
    await settle();
    expect(mocks.clients[0]?.connect).toHaveBeenCalledOnce();
  });

  it('keeps the recovery alarm armed after connecting and leaves healthy sockets alone', async () => {
    await import('./background');
    await settle();
    mocks.clients[0]!.endpoint.onReady({ endpointId: 'endpoint', turnToken: 'token' });
    alarmListener({ name: 'xopc.browser.reconnect' });
    await settle();
    expect(clearAlarm).not.toHaveBeenCalled();
    expect(mocks.clients).toHaveLength(1);
    expect(mocks.clients[0]!.disconnect).not.toHaveBeenCalled();
  });

  it('does not tear down the socket when only credentials rotate', async () => {
    await import('./background');
    await settle();
    storageListener({ 'xopc.browser.profile': { oldValue: { ...profile, accessToken: 'old' },
      newValue: { ...profile, accessToken: 'new' } } }, 'local');
    await settle();
    expect(mocks.clients[0]!.disconnect).not.toHaveBeenCalled();
    expect(mocks.clients).toHaveLength(1);
  });

  it('does not auto-enroll or retain the alarm after an explicit disconnect', async () => {
    mocks.readProfile.mockResolvedValue(undefined);
    mocks.isAutoConnectEnabled.mockResolvedValue(false);
    await import('./background');
    await settle();
    expect(mocks.autoConnectLocalGateway).not.toHaveBeenCalled();
    expect(createAlarm).not.toHaveBeenCalled();
    expect(clearAlarm).toHaveBeenCalled();
  });
});

import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: vi.fn(), identity: vi.fn(), preflight: vi.fn(), create: vi.fn(),
  start: vi.fn(), stop: vi.fn(), capture: vi.fn(), connect: vi.fn(),
}));
vi.mock('../../../query/query-client', () => ({
  queryClient: { fetchQuery: mocks.status, invalidateQueries: vi.fn() },
}));
vi.mock('../../../query/voice', () => ({
  voiceStatusOptions: () => ({}), voiceSessionIdentity: mocks.identity,
  preflightVoice: mocks.preflight, createVoiceConnection: mocks.create,
}));
vi.mock('../../../stores/gateway-store', () => ({
  useGatewayStore: { getState: () => ({ activeGatewayId: 'gateway' }) },
}));
vi.mock('../../../stores/preferences-store', () => ({
  usePreferencesStore: { getState: () => ({ language: 'zh' }) },
}));
vi.mock('../../../i18n/messages', () => ({ messages: () => ({ voice: { title: 'Call' } }) }));
vi.mock('../native-audio-session', () => ({
  NativeAudioSession: class {
    start = mocks.start;
    stop = mocks.stop;
    capture = mocks.capture;
  },
}));
vi.mock('../voice-transport', () => ({
  VoiceTransport: class {
    connect = mocks.connect;
    send = vi.fn();
    close = vi.fn();
  },
}));

import { voiceCall } from '../voice-call';

// Match the device runtime, not Node's more complete AbortSignal API.
const requireReactNative = createRequire(import.meta.resolve('react-native/package.json'));
const { AbortController: NativeAbortController } = requireReactNative('abort-controller/dist/abort-controller');
const target = { gatewayId: 'gateway', sessionKey: 'chat', background: false };
const identity = { sessionId: 'original', name: 'Assistant' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('AbortController', NativeAbortController);
  mocks.status.mockResolvedValue({ defaultEngine: 'omni', capabilities: { agent: { available: true }, omni: { available: true } } });
  mocks.identity.mockResolvedValue(identity);
  mocks.create.mockResolvedValue({ origin: 'https://gateway.example', session: { limits: { maxSessionMs: 60000 } } });
});
afterEach(async () => {
  await voiceCall.end();
  vi.unstubAllGlobals();
});

describe('mobile voice call entry with React Native AbortController', () => {
  it.each(['agent', 'omni'] as const)('prepares and connects a %s call', async engine => {
    expect(new AbortController().signal.throwIfAborted).toBeUndefined();
    await voiceCall.start({ ...target, engine });
    expect(voiceCall.getSnapshot()).toMatchObject({ phase: 'connected', engine, error: undefined });
    expect(mocks.status).toHaveBeenCalledOnce();
    expect(mocks.preflight).toHaveBeenCalledWith({ purpose: 'conversation', engine, sessionKey: 'chat' }, expect.anything());
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.identity).toHaveBeenCalledTimes(2);
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith(true);
  });

  it('does not open the microphone when cancelled during preparation', async () => {
    let resolveIdentity!: (value: typeof identity) => void;
    mocks.identity.mockImplementationOnce(() => new Promise(resolve => { resolveIdentity = resolve; }));
    const starting = voiceCall.start(target);
    await vi.waitFor(() => expect(mocks.identity).toHaveBeenCalledOnce());
    const ending = voiceCall.end();
    resolveIdentity(identity);
    await Promise.all([starting, ending]);
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(voiceCall.getSnapshot().phase).toBe('idle');
  });

  it('does not connect when cancelled during the post-creation identity check', async () => {
    let resolveIdentity!: (value: typeof identity) => void;
    mocks.identity.mockResolvedValueOnce(identity)
      .mockImplementationOnce(() => new Promise(resolve => { resolveIdentity = resolve; }));
    const starting = voiceCall.start(target);
    await vi.waitFor(() => expect(mocks.identity).toHaveBeenCalledTimes(2));
    const ending = voiceCall.end();
    resolveIdentity(identity);
    await Promise.all([starting, ending]);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalledWith(true);
    expect(voiceCall.getSnapshot().phase).toBe('idle');
  });

  it('still rejects a changed session identity before connecting', async () => {
    mocks.identity.mockResolvedValueOnce(identity).mockResolvedValueOnce({ sessionId: 'changed' });
    await voiceCall.start(target);
    expect(voiceCall.getSnapshot()).toMatchObject({ phase: 'paused', error: 'SESSION_CHANGED' });
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalled();
  });
});

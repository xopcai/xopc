import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: vi.fn(), identity: vi.fn(), preflight: vi.fn(), create: vi.fn(), cancel: vi.fn(),
  start: vi.fn(), stop: vi.fn(), capture: vi.fn(), connect: vi.fn(),
}));
vi.mock('../../../query/query-client', () => ({
  queryClient: { fetchQuery: mocks.status, invalidateQueries: vi.fn() },
}));
vi.mock('../../../query/voice', () => ({
  voiceStatusOptions: () => ({}), voiceSessionIdentity: mocks.identity,
  preflightVoice: mocks.preflight, createVoiceConnection: mocks.create,
  cancelVoiceConnection: mocks.cancel,
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
const target = { gatewayId: 'gateway', sessionKey: 'chat', background: false, identity: 'original', name: 'Assistant' };
const identity = { sessionId: 'original', name: 'Assistant' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('AbortController', NativeAbortController);
  mocks.status.mockResolvedValue({ defaultMode: 'natural', capabilities: { assistant: { available: true }, natural: { available: true } } });
  mocks.start.mockResolvedValue({ output: 'speaker', echoControl: 'verified', fullDuplex: true });
  mocks.identity.mockResolvedValue(identity);
  mocks.create.mockResolvedValue({ origin: 'https://gateway.example', session: { limits: { maxSessionMs: 60000 } } });
});
afterEach(async () => {
  await voiceCall.end();
  vi.unstubAllGlobals();
});

describe('mobile voice call entry with React Native AbortController', () => {
  it.each([['assistant', 'agent'], ['natural', 'omni']] as const)('prepares and connects a %s call', async (mode, engine) => {
    expect(new AbortController().signal.throwIfAborted).toBeUndefined();
    await voiceCall.start({ ...target, mode });
    expect(voiceCall.getSnapshot()).toMatchObject({ phase: 'connected', mode, engine, error: undefined });
    expect(mocks.status).toHaveBeenCalledOnce();
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith(true);
  });

  it('does not open the microphone when cancelled during preparation', async () => {
    let resolveStatus!: (value: { defaultMode: 'natural'; capabilities: { natural: { available: true } } }) => void;
    mocks.status.mockImplementationOnce(() => new Promise(resolve => { resolveStatus = resolve; }));
    const starting = voiceCall.start(target);
    await vi.waitFor(() => expect(mocks.status).toHaveBeenCalledOnce());
    const ending = voiceCall.end();
    resolveStatus({ defaultMode: 'natural', capabilities: { natural: { available: true } } });
    await Promise.all([starting, ending]);
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(voiceCall.getSnapshot().phase).toBe('idle');
  });

  it('checks identity and preflights when recovering a call', async () => {
    await voiceCall.start(target);
    await voiceCall.pause('NETWORK');
    mocks.identity.mockResolvedValueOnce({ sessionId: 'changed' });
    await voiceCall.resume();
    expect(mocks.identity).toHaveBeenCalledOnce();
    expect(mocks.preflight).toHaveBeenCalledOnce();
    expect(voiceCall.getSnapshot()).toMatchObject({ phase: 'paused', error: 'SESSION_CHANGED' });
  });
});

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { permission: vi.fn(), createRecorder: vi.fn(), request: vi.fn(), destroy: vi.fn(), unlink: vi.fn(), close: vi.fn(), release: vi.fn(), start: vi.fn(), stop: vi.fn() };
});
vi.mock('@kit.AbilityKit', () => ({ abilityAccessCtrl: { createAtManager: () => ({ requestPermissionsFromUser: mocks.permission }) } }));
vi.mock('@kit.ArkTS', () => ({ util: { generateRandomUUID: () => randomUUID() } }));
vi.mock('@kit.MediaKit', () => ({ media: { createAVRecorder: mocks.createRecorder,
  AudioSourceType: { AUDIO_SOURCE_TYPE_MIC: 1 }, CodecMimeType: { AUDIO_AAC: 'aac' }, ContainerFormatType: { CFT_MPEG_4A: 'm4a' } } }));
vi.mock('@kit.CoreFileKit', () => ({ fileIo: { OpenMode: { CREATE: 1, READ_WRITE: 2, READ_ONLY: 0 },
  open: async () => ({ fd: 1 }), stat: async () => ({ size: 64 }), read: async () => 64, close: mocks.close, unlink: mocks.unlink } }));
vi.mock('@kit.NetworkKit', () => ({ http: { createHttp: () => ({ request: mocks.request, destroy: mocks.destroy }),
  RequestMethod: { POST: 'POST' }, HttpDataType: { STRING: 'string' } } }));
vi.mock('@kit.BasicServicesKit', () => ({}));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { transferAuth: async () => ({ origin: 'https://gateway.example', token: 'test-token' }) } }));
vi.mock('../entry/src/main/ets/service/transport.ets', () => ({ XopcHttpError: class extends Error { constructor(status: number) { super('HTTP_' + status); } } }));

import { XopcVoiceCapture } from '../entry/src/main/ets/service/voiceCapture.ets';

describe('native voice lifecycle', () => {
  let voice: XopcVoiceCapture;
  const context = { cacheDir: '/test-cache' };
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks();
    mocks.permission.mockResolvedValue({ authResults: [0] });
    mocks.createRecorder.mockResolvedValue({ prepare: async () => {}, start: mocks.start, stop: mocks.stop, release: mocks.release, on() {} });
    mocks.request.mockResolvedValue({ responseCode: 200, result: JSON.stringify({ ok: true, payload: { text: '  A voice draft  ' } }) });
    voice = new XopcVoiceCapture();
  });
  afterEach(async () => { await voice.cancel(); vi.useRealTimers(); });
  it('records only after permission, stops at two minutes, and transcribes without sending chat input', async () => {
    await voice.start(context as never); expect(voice.state).toBe('recording');
    await vi.advanceTimersByTimeAsync(120000); expect(voice.state).toBe('ready'); expect(mocks.stop).toHaveBeenCalledOnce();
    expect(await voice.transcribe('zh')).toBe('A voice draft'); expect(voice.state).toBe('idle');
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.request.mock.calls[0]?.[0]).toBe('https://gateway.example/api/voice/transcriptions');
    expect(mocks.request.mock.calls[0]?.[1]).toMatchObject({ maxRedirects: 0, multiFormDataList: [{ name: 'audio', contentType: 'audio/m4a' }, { name: 'language', data: 'zh' }] });
    expect(mocks.unlink).toHaveBeenCalledOnce();
  });
  it('does not start capture when microphone permission is denied', async () => {
    mocks.permission.mockResolvedValue({ authResults: [-1] });
    await voice.start(context as never); expect(voice.state).toBe('idle');
    expect(voice.error).toBe('MICROPHONE_PERMISSION_REQUIRED'); expect(mocks.createRecorder).not.toHaveBeenCalled();
  });
  it('cancels while the permission prompt is pending without opening the microphone', async () => {
    let resolve!: (result: unknown) => void;
    mocks.permission.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const start = voice.start(context as never); const cancel = voice.cancel();
    resolve({ authResults: [0] }); await Promise.all([start, cancel]);
    expect(voice.state).toBe('idle'); expect(voice.busy).toBe(false); expect(mocks.createRecorder).not.toHaveBeenCalled();
  });
  it('keeps a failed transcription for explicit retry and releases recording resources on cancel', async () => {
    await voice.start(context as never); await voice.stop();
    mocks.request.mockResolvedValueOnce({ responseCode: 503, result: '{}' });
    expect(await voice.transcribe('')).toBeUndefined(); expect(voice.state).toBe('ready');
    expect(voice.error).toBe('HTTP_503'); expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.unlink).not.toHaveBeenCalled(); await voice.cancel(); expect(mocks.unlink).toHaveBeenCalledOnce();
  });
});

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { permission: vi.fn(), createRecorder: vi.fn(), request: vi.fn(), destroy: vi.fn(), unlink: vi.fn(), close: vi.fn(), release: vi.fn(), start: vi.fn(), stop: vi.fn(), read: vi.fn() };
});
vi.mock('@kit.AbilityKit', () => ({ abilityAccessCtrl: { createAtManager: () => ({ requestPermissionsFromUser: mocks.permission }) } }));
vi.mock('@kit.ArkTS', () => ({ util: { generateRandomUUID: () => randomUUID(), Base64Helper: class {
  async encodeToString(data: Uint8Array) { return Buffer.from(data).toString('base64'); }
} } }));
vi.mock('@kit.MediaKit', () => ({ media: { createAVRecorder: mocks.createRecorder,
  AudioSourceType: { AUDIO_SOURCE_TYPE_MIC: 1 }, CodecMimeType: { AUDIO_AAC: 'aac' }, ContainerFormatType: { CFT_MPEG_4A: 'm4a' } } }));
vi.mock('@kit.CoreFileKit', () => ({ fileIo: { OpenMode: { CREATE: 1, READ_WRITE: 2, READ_ONLY: 0 },
  open: async () => ({ fd: 1 }), stat: async () => ({ size: 64 }), read: mocks.read, close: mocks.close, unlink: mocks.unlink } }));
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
    mocks.read.mockResolvedValue(64);
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
  async function record() { await voice.start(context as never); await vi.advanceTimersByTimeAsync(1000); await voice.stop(); }
  it('sends a voice attachment without transcription and deletes only after acceptance', async () => {
    await record();
    const send = vi.fn(async (attachment) => {
      expect(mocks.unlink).not.toHaveBeenCalled();
      expect(attachment).toMatchObject({ type: 'voice', name: 'voice.m4a', mimeType: 'audio/mp4', size: 64 });
      expect(Buffer.from(attachment.data, 'base64')).toHaveLength(64);
      return true;
    });
    expect(await voice.send(send)).toBe(true); expect(send).toHaveBeenCalledOnce();
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.unlink).toHaveBeenCalledOnce(); expect(voice.state).toBe('idle');
  });
  it('preserves rejected or failed sends for retry', async () => {
    await record();
    expect(await voice.send(async () => false)).toBe(false);
    expect(await voice.send(async () => { throw new Error('OFFLINE'); })).toBe(false);
    expect(voice.state).toBe('ready'); expect(voice.busy).toBe(false); expect(mocks.unlink).not.toHaveBeenCalled();
    expect(await voice.send(async () => true)).toBe(true);
  });
  it('rejects accidental short recordings without sending', async () => {
    await voice.start(context as never); await voice.stop(); const send = vi.fn();
    expect(await voice.send(send)).toBe(false); expect(send).not.toHaveBeenCalled(); expect(voice.error).toBe('RECORDING_TOO_SHORT');
  });
  it('rejects incomplete file reads without losing the recording', async () => {
    await record(); mocks.read.mockResolvedValueOnce(32); const send = vi.fn();
    expect(await voice.send(send)).toBe(false); expect(send).not.toHaveBeenCalled(); expect(voice.state).toBe('ready');
    expect(mocks.unlink).not.toHaveBeenCalled(); expect(voice.error).toBe('INCOMPLETE_RECORDING');
  });
  it('cancels an in-flight file read before invoking the chat sender', async () => {
    await record(); let finish!: (size: number) => void;
    mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const send = vi.fn(); const pending = voice.send(send); await vi.advanceTimersByTimeAsync(0);
    const cancel = voice.cancel(); finish(64); await cancel;
    expect(await pending).toBe(false); expect(send).not.toHaveBeenCalled(); expect(voice.state).toBe('idle');
  });
  it('does not send twice while acceptance is pending', async () => {
    await record(); let finish!: (accepted: boolean) => void;
    const send = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const pending = voice.send(send); await vi.advanceTimersByTimeAsync(0);
    expect(await voice.send(send)).toBe(false); finish(true); expect(await pending).toBe(true); expect(send).toHaveBeenCalledOnce();
  });
});

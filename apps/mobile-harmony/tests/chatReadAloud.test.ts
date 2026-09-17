import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn(), destroy: vi.fn(), createPlayer: vi.fn(), open: vi.fn(), close: vi.fn(), unlink: vi.fn() };
});
vi.mock('@kit.AbilityKit', () => ({}));
vi.mock('@kit.MediaKit', () => ({ media: { createAVPlayer: mock.createPlayer } }));
vi.mock('@kit.ArkTS', () => ({ util: { generateRandomUUID: randomUUID } }));
vi.mock('@kit.NetworkKit', () => ({ http: { createHttp: () => ({ request: mock.request, destroy: mock.destroy }), RequestMethod: { POST: 'POST' }, HttpDataType: { ARRAY_BUFFER: 'buffer' } } }));
vi.mock('@kit.CoreFileKit', () => ({ fileIo: { OpenMode: { CREATE: 1, READ_WRITE: 2 }, open: mock.open,
  write: async (_fd: number, bytes: ArrayBuffer) => bytes.byteLength, close: mock.close, unlink: mock.unlink } }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { transferAuth: async () => ({ origin: 'https://gateway.example', token: 'test-token' }) } }));
import { XopcChatReadAloud } from '../entry/src/main/ets/service/chatReadAloud.ets';
describe('chat read aloud lifecycle', () => {
  let reader: XopcChatReadAloud;
  let player: { on: ReturnType<typeof vi.fn>; prepare: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; duration: number };
  let events: Map<string, (...args: any[]) => void>;
  const context = { cacheDir: '/test-cache' } as never;
  beforeEach(() => {
    vi.resetAllMocks(); reader = new XopcChatReadAloud(); events = new Map();
    player = { on: vi.fn((event, listener) => events.set(event, listener)), prepare: vi.fn(async () => {}), play: vi.fn(async () => {}), release: vi.fn(async () => {}), pause: vi.fn(async () => {}), duration: 1000 };
    mock.createPlayer.mockResolvedValue(player); mock.open.mockResolvedValue({ fd: 3 }); mock.request.mockResolvedValue({ responseCode: 200, result: new ArrayBuffer(8) });
  });
  afterEach(async () => { await reader.stop(); });
  it('uses authenticated bounded TTS, handles play/pause and removes only its own cache file', async () => {
    await reader.speak(context, 'Hello', 'row-1', 'en');
    expect(mock.request).toHaveBeenCalledWith('https://gateway.example/api/voice/speech', expect.objectContaining({ maxRedirects: 0, header: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' } }));
    events.get('stateChange')?.('initialized'); expect(player.prepare).toHaveBeenCalledOnce();
    events.get('stateChange')?.('prepared'); expect(player.play).toHaveBeenCalledOnce();
    events.get('stateChange')?.('playing'); await reader.toggle(); expect(player.pause).toHaveBeenCalledOnce();
    events.get('stateChange')?.('paused'); await reader.toggle(); expect(player.play).toHaveBeenCalledTimes(2);
    await reader.stop(); expect(reader.state).toBe('idle'); expect(player.release).toHaveBeenCalledOnce();
    expect(mock.close).toHaveBeenCalledOnce(); expect(mock.unlink.mock.calls[0][0]).toMatch(/^\/test-cache\/xopc-speech-[\w-]+\.audio$/);
  });
  it('does not create a player after navigation cancels an in-flight request', async () => {
    let resolve!: (value: unknown) => void; mock.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const speech = reader.speak(context, 'Hello', 'one', 'zh'); await vi.waitFor(() => expect(mock.request).toHaveBeenCalledOnce());
    await reader.stop(); resolve({ responseCode: 200, result: new ArrayBuffer(8) }); await speech;
    expect(mock.createPlayer).not.toHaveBeenCalled(); expect(mock.open).not.toHaveBeenCalled(); expect(reader.state).toBe('idle');
  });
  it('keeps only the latest simultaneous request', async () => {
    await Promise.all([reader.speak(context, 'first', 'one', 'en'), reader.speak(context, 'second', 'two', 'en')]);
    expect(mock.request).toHaveBeenCalledOnce(); expect(reader.sourceId).toBe('two');
  });
  it('surfaces HTTP errors without trying to decode error bodies as audio', async () => {
    mock.request.mockResolvedValueOnce({ responseCode: 503, result: new ArrayBuffer(8) });
    await reader.speak(context, 'Hello', 'one', 'en'); expect(reader.error).toBe('SPEECH_HTTP_503'); expect(reader.state).toBe('idle'); expect(mock.createPlayer).not.toHaveBeenCalled();
  });
});

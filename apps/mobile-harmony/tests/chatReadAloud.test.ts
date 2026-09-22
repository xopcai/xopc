import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn(), destroy: vi.fn(), createPlayer: vi.fn(), open: vi.fn(), close: vi.fn(), unlink: vi.fn(),
    createSession: vi.fn(), getWantAgent: vi.fn(), startBackground: vi.fn(), stopBackground: vi.fn() };
});
vi.mock('@kit.AbilityKit', () => ({ wantAgent: { getWantAgent: mock.getWantAgent,
  OperationType: { START_ABILITY: 1 }, WantAgentFlags: { UPDATE_PRESENT_FLAG: 3 } } }));
vi.mock('@kit.AVSessionKit', () => ({ avSession: { createAVSession: mock.createSession, PlaybackState: {
  PLAYBACK_STATE_PLAY: 2, PLAYBACK_STATE_PAUSE: 3, PLAYBACK_STATE_STOP: 6 } } }));
vi.mock('@kit.BackgroundTasksKit', () => ({ backgroundTaskManager: { startBackgroundRunning: mock.startBackground,
  stopBackgroundRunning: mock.stopBackground, BackgroundMode: { AUDIO_PLAYBACK: 2 } } }));
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
  let session: { on: ReturnType<typeof vi.fn>; setAVMetadata: ReturnType<typeof vi.fn>; setAVPlaybackState: ReturnType<typeof vi.fn>;
    activate: ReturnType<typeof vi.fn>; deactivate: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
  let events: Map<string, (...args: any[]) => void>;
  const context = { cacheDir: '/test-cache' } as never;
  beforeEach(() => {
    vi.resetAllMocks(); reader = new XopcChatReadAloud(); events = new Map();
    player = { on: vi.fn((event, listener) => events.set(event, listener)), prepare: vi.fn(async () => {}), play: vi.fn(async () => {}), release: vi.fn(async () => {}), pause: vi.fn(async () => {}), duration: 1000 };
    session = { on: vi.fn(), setAVMetadata: vi.fn(async () => {}), setAVPlaybackState: vi.fn(async () => {}),
      activate: vi.fn(async () => {}), deactivate: vi.fn(async () => {}), destroy: vi.fn(async () => {}) };
    mock.createPlayer.mockResolvedValue(player); mock.open.mockResolvedValue({ fd: 3 }); mock.request.mockResolvedValue({ responseCode: 200, result: new ArrayBuffer(8) });
    mock.createSession.mockResolvedValue(session); mock.getWantAgent.mockResolvedValue({}); mock.startBackground.mockResolvedValue(undefined); mock.stopBackground.mockResolvedValue(undefined);
  });
  afterEach(async () => { await reader.stop(); });
  it('uses authenticated bounded TTS, handles play/pause and removes only its own cache file', async () => {
    await reader.speak(context, 'Hello', 'row-1', 'en');
    expect(mock.createSession).toHaveBeenCalledWith(context, 'xopc-chat-read-aloud', 'audio');
    expect(mock.startBackground).toHaveBeenCalledWith(context, 2, {});
    expect(mock.request).toHaveBeenCalledWith('https://gateway.example/api/voice/speech', expect.objectContaining({ maxRedirects: 0, header: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' } }));
    events.get('stateChange')?.('initialized'); expect(player.prepare).toHaveBeenCalledOnce();
    events.get('stateChange')?.('prepared'); expect(player.play).toHaveBeenCalledOnce();
    events.get('stateChange')?.('playing'); await reader.toggle(); expect(player.pause).toHaveBeenCalledOnce();
    events.get('stateChange')?.('paused'); await reader.toggle(); expect(player.play).toHaveBeenCalledTimes(2);
    await reader.stop(); expect(reader.state).toBe('idle'); expect(player.release).toHaveBeenCalledOnce();
    expect(session.deactivate).toHaveBeenCalledOnce(); expect(session.destroy).toHaveBeenCalledOnce();
    expect(mock.stopBackground).toHaveBeenCalledWith(context);
    expect(mock.close).toHaveBeenCalledOnce(); expect(mock.unlink.mock.calls[0][0]).toMatch(/^\/test-cache\/xopc-speech-[\w-]+\.audio$/);
  });
  it('keeps current playback alive when the ability moves to the background', async () => {
    await reader.speak(context, 'Hello', 'one', 'en');
    events.get('stateChange')?.('playing'); reader.continuousConversationId = 'conversation';
    reader.leaveForeground();
    expect(reader.continuousConversationId).toBe(''); expect(reader.state).toBe('playing');
    expect(player.release).not.toHaveBeenCalled(); expect(mock.stopBackground).not.toHaveBeenCalled();
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

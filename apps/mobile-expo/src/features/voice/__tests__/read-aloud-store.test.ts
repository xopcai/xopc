import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateSpeechChunk: vi.fn(),
  memory: new Map<string, string>(),
  players: [] as Array<{
    currentTime: number;
    playing: boolean;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    addListener: ReturnType<typeof vi.fn>;
    setPlaybackRate: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('expo-audio', () => ({
  setAudioModeAsync: vi.fn().mockResolvedValue(undefined),
  createAudioPlayer: vi.fn(() => {
    const player = {
      currentTime: 0,
      playing: false,
      play: vi.fn(),
      pause: vi.fn(),
      remove: vi.fn(),
      addListener: vi.fn(),
      setPlaybackRate: vi.fn(),
    };
    mocks.players.push(player);
    return player;
  }),
}));

vi.mock('../../../storage/mmkv', () => ({
  KEYS: { readAloudConsent: 'voice.readAloudConsent' },
  storage: {
    getString: (key: string) => mocks.memory.get(key),
    set: (key: string, value: string) => mocks.memory.set(key, value),
  },
}));

vi.mock('../read-aloud-api', () => ({ generateSpeechChunk: mocks.generateSpeechChunk }));
vi.mock('../../../product/usage-metrics', () => ({
  recordInteractionPerformanceEvent: vi.fn(),
  recordUsageEvent: vi.fn(),
}));
vi.mock('../read-aloud-cache', () => ({
  ReadAloudCache: class {
    write(index: number) { return `file:///speech-${index}.mp3`; }
    remove() {}
  },
}));

import { useReadAloudStore, type ReadAloudInput } from '../read-aloud-store';

const input: ReadAloudInput = {
  source: { id: 'message-1', sessionKey: 'session-1', title: 'AI response' },
  text: 'A readable response.',
  language: 'en-US',
};

describe('read aloud store', () => {
  beforeEach(() => {
    useReadAloudStore.getState().stop();
    mocks.memory.clear();
    mocks.players.length = 0;
    mocks.generateSpeechChunk.mockReset();
    mocks.generateSpeechChunk.mockResolvedValue({
      bytes: new Uint8Array([1]),
      mimeType: 'audio/mpeg',
    });
  });

  it('requires one-time consent before sending text to the speech provider', () => {
    useReadAloudStore.getState().requestStart(input);

    expect(useReadAloudStore.getState().consentRequired).toBe(true);
    expect(mocks.generateSpeechChunk).not.toHaveBeenCalled();
  });

  it('keeps the store idle when an app background event pauses without an active source', () => {
    useReadAloudStore.getState().pause();
    expect(useReadAloudStore.getState().status).toBe('idle');
  });

  it('starts playback after consent and reuses the saved decision', async () => {
    useReadAloudStore.getState().requestStart(input);
    useReadAloudStore.getState().acceptConsent();

    await vi.waitFor(() => expect(useReadAloudStore.getState().status).toBe('playing'));
    expect(mocks.memory.get('voice.readAloudConsent')).toBe('accepted');
    expect(mocks.generateSpeechChunk).toHaveBeenCalledWith(expect.objectContaining({
      text: input.text,
      language: 'en-US',
    }));
    expect(mocks.players[0]?.setPlaybackRate).toHaveBeenCalledWith(1);
  });

  it('uses the native playback-rate method when changing speed', async () => {
    mocks.memory.set('voice.readAloudConsent', 'accepted');
    useReadAloudStore.getState().requestStart(input);

    await vi.waitFor(() => expect(useReadAloudStore.getState().status).toBe('playing'));
    useReadAloudStore.getState().cycleRate();

    expect(mocks.players[0]?.setPlaybackRate).toHaveBeenLastCalledWith(1.25);
  });

  it('pauses native playback before releasing it when stopped', async () => {
    mocks.memory.set('voice.readAloudConsent', 'accepted');
    useReadAloudStore.getState().requestStart(input);

    await vi.waitFor(() => expect(useReadAloudStore.getState().status).toBe('playing'));
    const activePlayer = mocks.players[0];
    useReadAloudStore.getState().stop();

    expect(activePlayer?.pause).toHaveBeenCalledOnce();
    expect(activePlayer?.remove).toHaveBeenCalledOnce();
    expect(useReadAloudStore.getState().status).toBe('idle');
  });

  it('cancels preparation when the active message is tapped again', async () => {
    mocks.memory.set('voice.readAloudConsent', 'accepted');
    let resolveSpeech: ((value: { bytes: Uint8Array; mimeType: string }) => void) | undefined;
    mocks.generateSpeechChunk.mockImplementation(() => new Promise((resolve) => {
      resolveSpeech = resolve;
    }));

    useReadAloudStore.getState().requestStart(input);
    expect(useReadAloudStore.getState().status).toBe('preparing');
    useReadAloudStore.getState().requestStart(input);
    expect(useReadAloudStore.getState().status).toBe('idle');

    resolveSpeech?.({ bytes: new Uint8Array([1]), mimeType: 'audio/mpeg' });
    await Promise.resolve();
    expect(useReadAloudStore.getState().status).toBe('idle');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateSpeechChunk: vi.fn(),
  startLiveActivity: vi.fn(),
  updateLiveActivity: vi.fn(),
  endLiveActivity: vi.fn(),
  playerSources: [] as unknown[],
  playerOptions: [] as unknown[],
  mediaControlsError: null as Error | null,
  players: [] as Array<{
    currentTime: number;
    playing: boolean;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    replace: ReturnType<typeof vi.fn>;
    addListener: ReturnType<typeof vi.fn>;
    setPlaybackRate: ReturnType<typeof vi.fn>;
    setActiveForLockScreen: ReturnType<typeof vi.fn>;
    clearLockScreenControls: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('expo-audio', () => ({
  setAudioModeAsync: vi.fn().mockResolvedValue(undefined),
  createAudioPlayer: vi.fn((source: unknown, options: unknown) => {
    mocks.playerSources.push(source);
    mocks.playerOptions.push(options);
    const player = {
      currentTime: 0,
      playing: false,
      play: vi.fn(),
      pause: vi.fn(),
      remove: vi.fn(),
      replace: vi.fn(),
      addListener: vi.fn(),
      setPlaybackRate: vi.fn(),
      setActiveForLockScreen: vi.fn(() => {
        if (mocks.mediaControlsError) throw mocks.mediaControlsError;
      }),
      clearLockScreenControls: vi.fn(),
    };
    mocks.players.push(player);
    return player;
  }),
}));

vi.mock('../read-aloud-api', () => ({ generateSpeechChunk: mocks.generateSpeechChunk }));
vi.mock('../read-aloud-live-activity', () => ({
  startReadAloudLiveActivity: mocks.startLiveActivity,
  updateReadAloudLiveActivity: mocks.updateLiveActivity,
  endReadAloudLiveActivity: mocks.endLiveActivity,
}));
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
    useReadAloudStore.getState().disableContinuous();
    mocks.players.length = 0;
    mocks.playerSources.length = 0;
    mocks.playerOptions.length = 0;
    mocks.mediaControlsError = null;
    mocks.generateSpeechChunk.mockReset();
    mocks.startLiveActivity.mockReset();
    mocks.updateLiveActivity.mockReset();
    mocks.endLiveActivity.mockReset();
    mocks.generateSpeechChunk.mockResolvedValue({
      bytes: new Uint8Array([1]),
      mimeType: 'audio/mpeg',
    });
  });

  it('keeps continuous reading scoped to one chat', () => {
    useReadAloudStore.getState().enableContinuous('session-1');
    expect(useReadAloudStore.getState().continuousSessionKey).toBe('session-1');

    useReadAloudStore.getState().disableContinuous();
    expect(useReadAloudStore.getState().continuousSessionKey).toBeNull();
  });

  it('keeps the store idle when an app background event pauses without an active source', () => {
    useReadAloudStore.getState().pause();
    expect(useReadAloudStore.getState().status).toBe('idle');
  });

  it('starts playback through the consent-protected speech API', async () => {
    useReadAloudStore.getState().requestStart(input);

    await vi.waitFor(() => expect(useReadAloudStore.getState().status).toBe('playing'));
    expect(mocks.generateSpeechChunk).toHaveBeenCalledWith(expect.objectContaining({
      text: input.text,
      language: 'en-US',
    }));
    expect(mocks.players[0]?.setPlaybackRate).toHaveBeenCalledWith(1);
    expect(mocks.players[0]?.setActiveForLockScreen).toHaveBeenCalledWith(true, {
      title: input.source.title,
      artist: 'xopc AI',
      albumTitle: 'AI read aloud',
    });
    expect(mocks.players[0]?.replace).toHaveBeenCalledWith({ uri: 'file:///speech-0.mp3' });
    expect(mocks.startLiveActivity).toHaveBeenCalledWith(expect.objectContaining({
      sessionKey: input.source.sessionKey,
      status: 'preparing',
      title: input.source.title,
    }));
  });

  it('keeps core playback working when system media controls are unavailable', async () => {
    const mediaControlsError = new Error('Native media controls failed');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.mediaControlsError = mediaControlsError;

    try {
      useReadAloudStore.getState().requestStart(input);

      await vi.waitFor(() => expect(useReadAloudStore.getState().status).toBe('playing'));
      expect(warnSpy).toHaveBeenCalledWith(
        '[ReadAloud] System media controls unavailable',
        mediaControlsError,
      );
      expect(mocks.generateSpeechChunk).toHaveBeenCalledOnce();
      expect(mocks.players[0]?.replace).toHaveBeenCalledWith({ uri: 'file:///speech-0.mp3' });
      expect(mocks.players[0]?.play).toHaveBeenCalledOnce();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('waits for playable audio before activating system media controls', () => {
    mocks.generateSpeechChunk.mockImplementation(() => new Promise(() => {}));

    useReadAloudStore.getState().requestStart(input);

    expect(useReadAloudStore.getState().status).toBe('preparing');
    expect(mocks.players).toHaveLength(1);
    expect(mocks.playerSources).toEqual([null]);
    expect(mocks.playerOptions).toEqual([{
      updateInterval: 250,
      keepAudioSessionActive: true,
    }]);
    expect(mocks.players[0]?.setActiveForLockScreen).not.toHaveBeenCalled();
    expect(mocks.players[0]?.replace).not.toHaveBeenCalled();
  });

  it('uses the native playback-rate method when changing speed', async () => {
    useReadAloudStore.getState().requestStart(input);

    await vi.waitFor(() => expect(useReadAloudStore.getState().status).toBe('playing'));
    useReadAloudStore.getState().cycleRate();

    expect(mocks.players[0]?.setPlaybackRate).toHaveBeenLastCalledWith(1.25);
  });

  it('pauses native playback before releasing it when stopped', async () => {
    useReadAloudStore.getState().requestStart(input);

    await vi.waitFor(() => expect(useReadAloudStore.getState().status).toBe('playing'));
    const activePlayer = mocks.players[0];
    useReadAloudStore.getState().stop();

    expect(activePlayer?.pause).toHaveBeenCalledOnce();
    expect(activePlayer?.clearLockScreenControls).toHaveBeenCalledOnce();
    expect(activePlayer?.remove).toHaveBeenCalledOnce();
    expect(useReadAloudStore.getState().status).toBe('idle');
  });

  it('reflects lock-screen pause and resume events in the global player', async () => {
    useReadAloudStore.getState().requestStart(input);

    await vi.waitFor(() => expect(useReadAloudStore.getState().status).toBe('playing'));
    const listener = mocks.players[0]?.addListener.mock.calls[0]?.[1] as ((status: {
      currentTime: number;
      didJustFinish: boolean;
      duration: number;
      isLoaded: boolean;
      playing: boolean;
    }) => void) | undefined;
    listener?.({ currentTime: 1, didJustFinish: false, duration: 10, isLoaded: true, playing: true });
    listener?.({ currentTime: 1, didJustFinish: false, duration: 10, isLoaded: true, playing: false });
    expect(useReadAloudStore.getState().status).toBe('paused');

    listener?.({ currentTime: 1, didJustFinish: false, duration: 10, isLoaded: true, playing: true });
    expect(useReadAloudStore.getState().status).toBe('playing');
  });

  it('reuses one media session across speech chunks', async () => {
    useReadAloudStore.getState().requestStart({
      ...input,
      text: 'A'.repeat(421),
    });

    await vi.waitFor(() => expect(useReadAloudStore.getState().status).toBe('playing'));
    const activePlayer = mocks.players[0];
    const listener = activePlayer?.addListener.mock.calls[0]?.[1] as ((status: {
      currentTime: number;
      didJustFinish: boolean;
      duration: number;
      isLoaded: boolean;
      playing: boolean;
    }) => void) | undefined;
    listener?.({ currentTime: 10, didJustFinish: false, duration: 10, isLoaded: true, playing: true });
    listener?.({ currentTime: 10, didJustFinish: true, duration: 10, isLoaded: true, playing: false });

    await vi.waitFor(() => expect(activePlayer?.replace).toHaveBeenCalledTimes(2));
    expect(mocks.players).toHaveLength(1);
    expect(activePlayer?.setActiveForLockScreen).toHaveBeenCalledOnce();
    expect(activePlayer?.remove).not.toHaveBeenCalled();
    expect(useReadAloudStore.getState().currentChunkIndex).toBe(1);

    listener?.({ currentTime: 10, didJustFinish: true, duration: 10, isLoaded: true, playing: false });
    await Promise.resolve();
    expect(activePlayer?.replace).toHaveBeenCalledTimes(2);
    expect(useReadAloudStore.getState().currentChunkIndex).toBe(1);
  });

  it('ends the media session and returns to idle when playback completes', async () => {
    useReadAloudStore.getState().requestStart(input);

    await vi.waitFor(() => expect(useReadAloudStore.getState().status).toBe('playing'));
    const listener = mocks.players[0]?.addListener.mock.calls[0]?.[1] as ((status: {
      currentTime: number;
      didJustFinish: boolean;
      duration: number;
      isLoaded: boolean;
      playing: boolean;
    }) => void) | undefined;
    listener?.({ currentTime: 10, didJustFinish: false, duration: 10, isLoaded: true, playing: true });
    listener?.({ currentTime: 10, didJustFinish: true, duration: 10, isLoaded: true, playing: false });

    expect(mocks.endLiveActivity).toHaveBeenCalled();
    expect(mocks.players[0]?.remove).toHaveBeenCalledOnce();
    expect(useReadAloudStore.getState()).toMatchObject({
      source: null,
      status: 'idle',
      currentTime: 0,
      duration: 0,
    });
  });

  it('cancels preparation when the active message is tapped again', async () => {
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

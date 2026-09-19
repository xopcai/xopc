import { beforeEach, describe, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => ({
  listener: undefined as ((status: {
    currentTime: number;
    didJustFinish?: boolean;
    error?: string;
    playing?: boolean;
  }) => void) | undefined,
  play: vi.fn(),
  remove: vi.fn(),
  removeListener: vi.fn(),
  setMode: vi.fn(async () => {}),
}));

vi.mock('expo-audio', () => ({
  setAudioModeAsync: audio.setMode,
  createAudioPlayer: vi.fn(() => ({
    addListener: vi.fn((_event: string, listener: typeof audio.listener) => {
      audio.listener = listener;
      return { remove: audio.removeListener };
    }),
    play: audio.play,
    remove: audio.remove,
  })),
}));

vi.mock('../../voice/audio-playback-coordinator', () => ({
  claimAudioPlayback: vi.fn(),
  isAudioCaptureActive: vi.fn(() => false),
  releaseAudioPlayback: vi.fn(),
}));

vi.mock('../message-audio-cache', () => ({
  MessageAudioCache: class MessageAudioCache {
    async download(): Promise<string> { return 'file:///cached.mp3'; }
    remove(): void {}
  },
}));

import { playAssistantAudioTrack } from '../assistant-audio-autoplay';

const item = {
  key: 'chat:reply',
  uri: 'file:///reply.mp3',
  mimeType: 'audio/mpeg',
  conversationId: 'chat',
};

describe('assistant audio autoplay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    audio.listener = undefined;
  });

  it('releases a player that never reports progress or completion', async () => {
    const playback = playAssistantAudioTrack(item, 100);
    const rejected = expect(playback).rejects.toThrow('playback stalled');
    await vi.advanceTimersByTimeAsync(101);

    await rejected;
    expect(audio.removeListener).toHaveBeenCalledOnce();
    expect(audio.remove).toHaveBeenCalledOnce();
  });

  it('completes normally and clears the watchdog', async () => {
    const playback = playAssistantAudioTrack(item, 100);
    await vi.advanceTimersByTimeAsync(0);
    audio.listener?.({ currentTime: 1, playing: false, didJustFinish: true });

    await expect(playback).resolves.toBe('completed');
    await vi.advanceTimersByTimeAsync(101);
    expect(audio.remove).toHaveBeenCalledOnce();
  });
});

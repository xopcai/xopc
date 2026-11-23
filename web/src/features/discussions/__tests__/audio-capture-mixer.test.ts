// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { acquireDiscussionAudioStream } from '../audio-capture-mixer';

function createMockTrack(kind: 'audio' | 'video') {
  const listeners = new Map<string, Array<() => void>>();
  return {
    kind,
    stopped: false,
    stop() {
      this.stopped = true;
    },
    addEventListener(event: string, cb: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    },
    removeEventListener() {},
  };
}

function createMockStream(tracks: Array<ReturnType<typeof createMockTrack>>) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  } as unknown as MediaStream;
}

describe('acquireDiscussionAudioStream', () => {
  const origMediaDevices = navigator.mediaDevices;
  const origAudioContext = globalThis.AudioContext;
  const origMediaStream = globalThis.MediaStream;

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: origMediaDevices,
    });
    globalThis.AudioContext = origAudioContext;
    globalThis.MediaStream = origMediaStream;
    vi.restoreAllMocks();
  });

  it('acquires plain microphone audio in microphone mode and cleans up tracks', async () => {
    const micTrack = createMockTrack('audio');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => createMockStream([micTrack])),
      },
    });

    const acquired = await acquireDiscussionAudioStream('microphone');
    expect(acquired.mode).toBe('microphone');
    expect(micTrack.stopped).toBe(false);
    acquired.cleanup();
    expect(micTrack.stopped).toBe(true);
  });

  it('mixes system audio + mic in meeting_mix mode and immediately discards display video tracks', async () => {
    const micTrack = createMockTrack('audio');
    const sysAudioTrack = createMockTrack('audio');
    const sysVideoTrack = createMockTrack('video');
    const mixedTrack = createMockTrack('audio');
    let audioContextClosed = false;

    globalThis.MediaStream = class {
      private tracks: Array<ReturnType<typeof createMockTrack>>;
      constructor(tracks: Array<ReturnType<typeof createMockTrack>> = []) {
        this.tracks = tracks;
      }
      getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
      getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
    } as unknown as typeof MediaStream;

    globalThis.AudioContext = class {
      state = 'running';
      createMediaStreamDestination() {
        return { stream: createMockStream([mixedTrack]) };
      }
      createDynamicsCompressor() {
        return {
          threshold: { value: 0 },
          knee: { value: 0 },
          ratio: { value: 0 },
          attack: { value: 0 },
          release: { value: 0 },
          connect: vi.fn(),
        };
      }
      createGain() {
        return { gain: { value: 1 }, connect: vi.fn() };
      }
      createMediaStreamSource() {
        return { connect: vi.fn() };
      }
      async close() {
        audioContextClosed = true;
      }
    } as unknown as typeof AudioContext;

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => createMockStream([micTrack])),
        getDisplayMedia: vi.fn(async () => createMockStream([sysAudioTrack, sysVideoTrack])),
      },
    });

    const acquired = await acquireDiscussionAudioStream('meeting_mix');
    expect(acquired.mode).toBe('meeting_mix');
    // Video track must be stopped immediately so screen pixels are never recorded
    expect(sysVideoTrack.stopped).toBe(true);
    expect(sysAudioTrack.stopped).toBe(false);
    expect(micTrack.stopped).toBe(false);

    acquired.cleanup();
    expect(sysAudioTrack.stopped).toBe(true);
    expect(micTrack.stopped).toBe(true);
    expect(mixedTrack.stopped).toBe(true);
    expect(audioContextClosed).toBe(true);
  });

  it('throws a clear error and releases mic if display capture has no audio track', async () => {
    const micTrack = createMockTrack('audio');
    const sysVideoOnly = createMockTrack('video');

    globalThis.AudioContext = class {} as unknown as typeof AudioContext;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => createMockStream([micTrack])),
        getDisplayMedia: vi.fn(async () => createMockStream([sysVideoOnly])),
      },
    });

    await expect(acquireDiscussionAudioStream('meeting_mix')).rejects.toThrow(/No system or tab audio/);
    expect(micTrack.stopped).toBe(true);
    expect(sysVideoOnly.stopped).toBe(true);
  });
});

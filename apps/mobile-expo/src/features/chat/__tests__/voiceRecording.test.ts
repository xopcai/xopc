import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-audio', () => ({
  AudioModule: {
    AudioRecorder: class AudioRecorder {
      isRecording = false;
      uri = 'file:///tmp/recording.m4a';
      currentTime = 0;
      getStatus = vi.fn(() => ({ durationMillis: 0, metering: -20 }));
      record = vi.fn(() => {
        this.isRecording = true;
      });
      stop = vi.fn(async () => {
        this.isRecording = false;
      });
      prepareToRecordAsync = vi.fn(async () => {});
    },
  },
  RecordingPresets: {
    HIGH_QUALITY: {
      extension: '.m4a',
      sampleRate: 44100,
      numberOfChannels: 2,
      bitRate: 128000,
      android: {
        outputFormat: 'mpeg4',
        audioEncoder: 'aac',
      },
      ios: {
        outputFormat: 'aac ',
        audioQuality: 127,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
      },
      web: {
        mimeType: 'audio/webm',
        bitsPerSecond: 128000,
      },
    },
  },
  requestRecordingPermissionsAsync: vi.fn(async () => ({ granted: true })),
  setAudioModeAsync: vi.fn(async () => {}),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import { beginRecording, finishRecording, nativeRecordingOptionsForPlatform, readRecordingDurationMillis } from '../voiceRecording';

describe('nativeRecordingOptionsForPlatform', () => {
  it('flattens iOS recording preset fields for native AudioRecorder', () => {
    const options = nativeRecordingOptionsForPlatform('ios');

    expect(options).toMatchObject({
      extension: '.m4a',
      sampleRate: 44100,
      numberOfChannels: 2,
      bitRate: 128000,
      isMeteringEnabled: true,
      outputFormat: 'aac ',
      audioQuality: 127,
      linearPCMBitDepth: 16,
    });
    expect(options).not.toHaveProperty('ios');
    expect(options).not.toHaveProperty('android');
  });

  it('flattens Android recording preset fields for native AudioRecorder', () => {
    const options = nativeRecordingOptionsForPlatform('android');

    expect(options).toMatchObject({
      extension: '.m4a',
      sampleRate: 44100,
      numberOfChannels: 2,
      bitRate: 128000,
      isMeteringEnabled: true,
      outputFormat: 'mpeg4',
      audioEncoder: 'aac',
    });
    expect(options).not.toHaveProperty('ios');
    expect(options).not.toHaveProperty('android');
  });
});

describe('readRecordingDurationMillis', () => {
  it('uses the larger of status duration and currentTime before stop', () => {
    const recorder = {
      getStatus: () => ({ durationMillis: 1200 }),
      currentTime: 0.8,
    };

    expect(readRecordingDurationMillis(recorder as never)).toBe(1200);
  });

  it('falls back to currentTime when status duration is missing', () => {
    const recorder = {
      getStatus: () => ({ durationMillis: 0 }),
      currentTime: 2.45,
    };

    expect(readRecordingDurationMillis(recorder as never)).toBe(2450);
  });
});

describe('finishRecording', () => {
  it('captures duration before stop clears recorder state', async () => {
    const recorder = {
      uri: 'file:///tmp/recording.m4a',
      getStatus: vi
        .fn()
        .mockReturnValueOnce({ durationMillis: 1500 })
        .mockReturnValueOnce({ durationMillis: 0 }),
      currentTime: 1.5,
      stop: vi.fn().mockResolvedValue(undefined),
    };

    await expect(finishRecording(recorder as never)).resolves.toEqual({
      uri: 'file:///tmp/recording.m4a',
      durationMillis: 1500,
    });
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(recorder.getStatus).toHaveBeenCalledBefore(recorder.stop as never);
  });
});

describe('beginRecording', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls recorder status for live metering updates', async () => {
    const onStatus = vi.fn();
    const recorder = await beginRecording(onStatus);
    const getStatus = vi.mocked(recorder.getStatus);

    expect(onStatus).toHaveBeenCalledTimes(1);

    getStatus.mockReturnValue({ durationMillis: 120, metering: -12 } as never);
    await vi.advanceTimersByTimeAsync(100);
    expect(onStatus).toHaveBeenCalledTimes(2);
    expect(onStatus).toHaveBeenLastCalledWith(-12, 120);

    await finishRecording(recorder);
    await vi.advanceTimersByTimeAsync(200);
    expect(onStatus).toHaveBeenCalledTimes(2);
  });
});

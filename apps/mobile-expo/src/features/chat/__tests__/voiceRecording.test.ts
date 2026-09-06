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
      release = vi.fn();
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
    },
  },
  getRecordingPermissionsAsync: vi.fn(async () => ({
    status: 'granted',
    granted: true,
    canAskAgain: true,
    expires: 'never',
  })),
  requestRecordingPermissionsAsync: vi.fn(async () => ({ granted: true })),
  setAudioModeAsync: vi.fn(async () => {}),
}));

vi.mock('expo-file-system', () => ({
  File: class File {
    exists = false;
    delete = vi.fn();
  },
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { Platform } from 'react-native';

import {
  beginRecording,
  classifyVoiceTranscriptionFailure,
  finishRecording,
  nativeRecordingOptionsForPlatform,
  readRecordingDurationMillis,
  requestMicPermission,
  VoiceRecordingError,
} from '../voiceRecording';

describe('classifyVoiceTranscriptionFailure', () => {
  it('separates a missing gateway decoder from generic recognition failures', () => {
    expect(classifyVoiceTranscriptionFailure(
      new Error('HTTP 415: Audio decoder is unavailable; install ffmpeg'),
    )).toBe('decoder_unavailable');
    expect(classifyVoiceTranscriptionFailure(new Error('sherpa-onnx-node is not installed')))
      .toBe('runtime_unavailable');
    expect(classifyVoiceTranscriptionFailure(new Error('HTTP 503: STT is not configured')))
      .toBe('not_configured');
    expect(classifyVoiceTranscriptionFailure(new Error('unsupported audio codec')))
      .toBe('decoder_unavailable');
    expect(classifyVoiceTranscriptionFailure(new Error('request timed out'))).toBe('unknown');
  });
});

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

  it('stores durable capture recordings in the document directory', () => {
    expect(nativeRecordingOptionsForPlatform('ios', 'document')).toMatchObject({
      extension: '.m4a',
      directory: 'document',
    });
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
  beforeEach(() => {
    vi.mocked(setAudioModeAsync).mockClear();
  });

  it('captures duration before stop clears recorder state', async () => {
    const recorder = {
      uri: 'file:///tmp/recording.m4a',
      getStatus: vi
        .fn()
        .mockReturnValueOnce({ durationMillis: 1500 })
        .mockReturnValueOnce({ durationMillis: 0 }),
      currentTime: 1.5,
      stop: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };

    await expect(finishRecording(recorder as never)).resolves.toEqual({
      uri: 'file:///tmp/recording.m4a',
      durationMillis: 1500,
    });
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(recorder.release).toHaveBeenCalledOnce();
    expect(recorder.getStatus).toHaveBeenCalledBefore(recorder.stop as never);
    expect(setAudioModeAsync).toHaveBeenLastCalledWith({
      allowsRecording: false,
      playsInSilentMode: true,
    });
  });

  it('releases the recorder and reports the stop phase when Android stop fails', async () => {
    const recorder = {
      uri: null,
      getStatus: vi.fn(() => ({ durationMillis: 800 })),
      currentTime: 0.8,
      stop: vi.fn().mockRejectedValue(new Error('MediaRecorder stop failed')),
      release: vi.fn(),
    };

    await expect(finishRecording(recorder as never)).rejects.toMatchObject({
      name: 'VoiceRecordingError',
      phase: 'stop',
    });
    expect(recorder.release).toHaveBeenCalledOnce();
  });
});

describe('requestMicPermission', () => {
  beforeEach(() => {
    vi.mocked(getRecordingPermissionsAsync).mockReset();
    vi.mocked(requestRecordingPermissionsAsync).mockReset();
  });

  it('does not open a second prompt when permission is already granted', async () => {
    vi.mocked(getRecordingPermissionsAsync).mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
      expires: 'never',
    } as never);

    await expect(requestMicPermission()).resolves.toEqual({
      granted: true,
      canAskAgain: true,
      requested: false,
    });
    expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
  });

  it('preserves canAskAgain when Android has permanently denied access', async () => {
    vi.mocked(getRecordingPermissionsAsync).mockResolvedValue({
      status: 'denied',
      granted: false,
      canAskAgain: false,
      expires: 'never',
    } as never);

    await expect(requestMicPermission()).resolves.toEqual({
      granted: false,
      canAskAgain: false,
      requested: false,
    });
    expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
  });

  it('wraps native permission failures with their stage', async () => {
    vi.mocked(getRecordingPermissionsAsync).mockRejectedValue(new Error('native module mismatch'));

    await expect(requestMicPermission()).rejects.toEqual(expect.any(VoiceRecordingError));
    await expect(requestMicPermission()).rejects.toMatchObject({ phase: 'permission' });
  });
});

describe('beginRecording', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    vi.mocked(setAudioModeAsync).mockReset().mockResolvedValue(undefined);
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

  it('continues Android capture when the advisory audio mode change is rejected', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    vi.mocked(setAudioModeAsync).mockRejectedValueOnce(new Error('audio focus denied'));

    const recorder = await beginRecording(vi.fn());

    expect(recorder.isRecording).toBe(true);
    await finishRecording(recorder);
  });
});

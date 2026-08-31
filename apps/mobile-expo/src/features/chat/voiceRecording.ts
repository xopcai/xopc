/**
 * expo-audio microphone recording for native hold-to-speak UX.
 */
import {
  AudioModule,
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import type { AudioRecorder, RecordingOptions } from 'expo-audio';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { pauseActiveAudioPlayback } from '../voice/audio-playback-coordinator';

export type ExpoRecording = AudioRecorder;

export type MicrophonePermissionResult = {
  granted: boolean;
  canAskAgain: boolean;
  requested: boolean;
};

export type VoiceRecordingFailurePhase =
  | 'permission'
  | 'audio_mode'
  | 'prepare'
  | 'start'
  | 'stop';

export class VoiceRecordingError extends Error {
  constructor(
    readonly phase: VoiceRecordingFailurePhase,
    cause: unknown,
  ) {
    super(`Voice recording failed during ${phase}`, { cause });
    this.name = 'VoiceRecordingError';
  }
}

export type VoiceTranscriptionFailureKind =
  | 'decoder_unavailable'
  | 'not_configured'
  | 'runtime_unavailable'
  | 'unknown';

/**
 * HIGH_QUALITY records at 128kbps. Eight minutes stays comfortably below the
 * mobile 10MB attachment read limit, including container overhead.
 */
export const MAX_VOICE_RECORDING_MS = 8 * 60 * 1000;

export function classifyVoiceTranscriptionFailure(error: unknown): VoiceTranscriptionFailureKind {
  const message = error instanceof Error ? error.message : String(error);
  if (/ffmpeg|audio decoder|unsupported[_ ]audio[_ ]codec/i.test(message)) return 'decoder_unavailable';
  if (/stt.+not configured|enable stt|speech.to.text.+disabled/i.test(message)) {
    return 'not_configured';
  }
  if (/local voice runtime|sherpa|voice model|model.+not installed/i.test(message)) {
    return 'runtime_unavailable';
  }
  return 'unknown';
}

/** expo-audio only emits recordingStatusUpdate on finish/error — poll for live metering. */
const METERING_POLL_MS = 100;
const meteringPolls = new WeakMap<ExpoRecording, ReturnType<typeof setInterval>>();

function stopMeteringPoll(rec: ExpoRecording): void {
  const handle = meteringPolls.get(rec);
  if (handle != null) {
    clearInterval(handle);
    meteringPolls.delete(rec);
  }
}

function startMeteringPoll(
  rec: ExpoRecording,
  onStatus: (metering: number | undefined, durationMillis: number) => void,
): void {
  stopMeteringPoll(rec);
  const poll = () => {
    if (!rec.isRecording) {
      stopMeteringPoll(rec);
      return;
    }
    try {
      const status = rec.getStatus();
      onStatus(status.metering, status.durationMillis ?? 0);
    } catch {
      // The native recorder may be released between the timer tick and getStatus().
      stopMeteringPoll(rec);
    }
  };
  poll();
  meteringPolls.set(rec, setInterval(poll, METERING_POLL_MS));
}

type RecordingPlatform = 'ios' | 'android';

export function nativeRecordingOptionsForPlatform(
  platform: RecordingPlatform,
  directory?: RecordingOptions['directory'],
): Partial<RecordingOptions> {
  const preset = {
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  };
  const commonOptions = {
    extension: preset.extension,
    sampleRate: preset.sampleRate,
    numberOfChannels: preset.numberOfChannels,
    bitRate: preset.bitRate,
    isMeteringEnabled: preset.isMeteringEnabled,
    ...(directory ? { directory } : {}),
  };

  if (platform === 'ios') {
    return {
      ...commonOptions,
      ...preset.ios,
    } as Partial<RecordingOptions>;
  }

  return {
    ...commonOptions,
    ...preset.android,
  } as Partial<RecordingOptions>;
}

export async function requestMicPermission(): Promise<MicrophonePermissionResult> {
  try {
    const current = await getRecordingPermissionsAsync();
    if (current.granted || !current.canAskAgain) {
      return {
        granted: current.granted,
        canAskAgain: current.canAskAgain,
        requested: false,
      };
    }

    const requested = await requestRecordingPermissionsAsync();
    return {
      granted: requested.granted,
      canAskAgain: requested.canAskAgain,
      requested: true,
    };
  } catch (error) {
    throw new VoiceRecordingError('permission', error);
  }
}

async function restorePlaybackAudioMode(): Promise<void> {
  try {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
    });
  } catch {
    // Restoring playback must not turn a completed recording into a failure.
  }
}

export async function beginRecording(
  onStatus: (metering: number | undefined, durationMillis: number) => void,
  options?: { persistent?: boolean },
): Promise<ExpoRecording> {
  pauseActiveAudioPlayback();
  try {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });
  } catch (error) {
    throw new VoiceRecordingError('audio_mode', error);
  }

  const platform: RecordingPlatform = Platform.OS === 'ios' ? 'ios' : 'android';
  const recorder = new AudioModule.AudioRecorder(
    nativeRecordingOptionsForPlatform(platform, options?.persistent ? 'document' : undefined),
  );
  try {
    await recorder.prepareToRecordAsync();
  } catch (error) {
    recorder.release();
    await restorePlaybackAudioMode();
    throw new VoiceRecordingError('prepare', error);
  }
  try {
    recorder.record();
  } catch (error) {
    recorder.release();
    await restorePlaybackAudioMode();
    throw new VoiceRecordingError('start', error);
  }
  startMeteringPoll(recorder, onStatus);
  return recorder;
}

export async function discardRecording(rec: ExpoRecording): Promise<void> {
  const uri = rec.uri;
  stopMeteringPoll(rec);
  try {
    if (rec.isRecording) await rec.stop();
  } catch {
    /* already unloaded / too short on Android */
  } finally {
    rec.release();
    deleteRecordingFile(uri ?? rec.uri);
    await restorePlaybackAudioMode();
  }
}

export function deleteRecordingFile(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cleanup is best effort; never turn a successful capture into a failure.
  }
}

/** Read duration before stop — expo-audio resets durationMillis to 0 after stop(). */
export function readRecordingDurationMillis(rec: ExpoRecording): number {
  const fromStatus = rec.getStatus().durationMillis ?? 0;
  const fromCurrentTime = Math.round((rec.currentTime ?? 0) * 1000);
  return Math.max(fromStatus, fromCurrentTime);
}

export async function finishRecording(rec: ExpoRecording): Promise<{ uri: string | null; durationMillis: number }> {
  const durationMillis = readRecordingDurationMillis(rec);
  stopMeteringPoll(rec);
  try {
    await rec.stop();
    return { uri: rec.uri, durationMillis };
  } catch (error) {
    throw new VoiceRecordingError('stop', error);
  } finally {
    rec.release();
    await restorePlaybackAudioMode();
  }
}

export function inferRecordingMimeType(uri: string | null): string {
  const lower = uri?.split('?')[0]?.toLowerCase() ?? '';
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.caf')) return 'audio/x-caf';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  return 'audio/mp4';
}

/** Map dB-ish metering to bar fill 0–1 (fallback when metering missing). */
export function meteringToLevel(db: number | undefined): number {
  if (db == null || !Number.isFinite(db)) return 0.22;
  const minDb = -55;
  const maxDb = -5;
  const t = Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)));
  return 0.14 + t * 0.86;
}

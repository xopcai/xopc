/**
 * expo-audio microphone recording for hold-to-speak UX (native + web where supported).
 */
import {
  AudioModule,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import type { AudioRecorder, RecordingOptions } from 'expo-audio';
import { Platform } from 'react-native';

export type ExpoRecording = AudioRecorder;

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
    if (!rec.isRecording) return;
    const status = rec.getStatus();
    onStatus(status.metering, status.durationMillis ?? 0);
  };
  poll();
  meteringPolls.set(rec, setInterval(poll, METERING_POLL_MS));
}

type RecordingPlatform = typeof Platform.OS;

export function nativeRecordingOptionsForPlatform(
  platform: RecordingPlatform,
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
  };

  if (platform === 'ios') {
    return {
      ...commonOptions,
      ...preset.ios,
    } as Partial<RecordingOptions>;
  }

  if (platform === 'android') {
    return {
      ...commonOptions,
      ...preset.android,
    } as Partial<RecordingOptions>;
  }

  return {
    ...commonOptions,
    ...preset.web,
  } as Partial<RecordingOptions>;
}

export async function requestMicPermission(): Promise<boolean> {
  const { granted } = await requestRecordingPermissionsAsync();
  return granted;
}

export async function beginRecording(
  onStatus: (metering: number | undefined, durationMillis: number) => void,
): Promise<ExpoRecording> {
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
  });

  const recorder = new AudioModule.AudioRecorder(nativeRecordingOptionsForPlatform(Platform.OS));
  await recorder.prepareToRecordAsync();
  recorder.record();
  startMeteringPoll(recorder, onStatus);
  return recorder;
}

export async function discardRecording(rec: ExpoRecording): Promise<void> {
  stopMeteringPoll(rec);
  try {
    if (rec.isRecording) await rec.stop();
  } catch {
    /* already unloaded / too short on Android */
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
  await rec.stop();
  return { uri: rec.uri, durationMillis };
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

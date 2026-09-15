import { requireOptionalNativeModule } from 'expo';
import { randomUUID } from 'expo-crypto';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { storage } from '../../storage/mmkv';
import { useGatewayStore } from '../../stores/gateway-store';
import { claimAudioCapture, releaseAudioCapture } from '../voice/audio-playback-coordinator';
import { requestMicPermission } from '../chat/voiceRecording';

export type RecordingChunk = { sequence: number; epoch: number; sampleStart: number; sampleCount: number; bytes: number; sha256: string; uri: string };
export type LocalRecording = {
  id: string; recordedAt: number; state: 'recording' | 'paused' | 'saved' | 'interrupted';
  binding?: { gatewayId: string; deviceId: string; publicKey: string };
  directory?: string; discussionId?: string; noteId?: string; durationMs?: number;
};
type NativeRecording = {
  startRecording(id: string, title: string, stopLabel: string): Promise<string>;
  stopRecording(id: string): Promise<void>;
  activeRecording(): Promise<string | null>;
  recordingChunks(id: string): Promise<RecordingChunk[]>;
};
const native = requireOptionalNativeModule<NativeRecording>('XopcVoice');
export const recordingAvailable = typeof native?.startRecording === 'function';
const KEY = 'recordings.captures.v1';
const owner = Symbol('meeting-recording');
let commanding = false;
let loaded = false;
export const useRecordings = create<{ items: LocalRecording[] }>(() => ({ items: [] }));

export function loadRecordings(): void {
  const raw = storage.getString(KEY);
  if (!raw) { loaded = true; return; }
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== 'string' || !Number.isSafeInteger(row.recordedAt)
    || !['recording', 'paused', 'saved', 'interrupted'].includes(row.state))) throw new Error('RECORDING_INDEX_INVALID');
  useRecordings.setState({ items: rows as LocalRecording[] });
  loaded = true;
}

export function saveRecording(item: LocalRecording): void {
  if (!loaded) loadRecordings();
  const items = [item, ...useRecordings.getState().items.filter(row => row.id !== item.id)].sort((a, b) => b.recordedAt - a.recordedAt);
  storage.set(KEY, JSON.stringify(items));
  useRecordings.setState({ items });
}

export async function reconcileRecording(): Promise<void> {
  if (!recordingAvailable || commanding) return;
  const active = await native!.activeRecording();
  if (commanding) return;
  for (const item of useRecordings.getState().items) {
    if (item.state === 'recording' && item.id !== active) saveRecording({ ...item, state: 'interrupted' });
  }
  if (active) claimAudioCapture(owner);
  else releaseAudioCapture(owner);
}

async function command<T>(action: () => Promise<T>): Promise<T> {
  if (commanding) throw new Error('RECORDING_BUSY');
  commanding = true;
  try { return await action(); } finally { commanding = false; }
}

export async function startRecording(labels: { title: string; stop: string }, paused?: LocalRecording): Promise<LocalRecording> {
  return command(async () => {
    if (!loaded) loadRecordings();
    if (!recordingAvailable) throw new Error('NATIVE_BUILD_REQUIRED');
    if (paused && paused.state !== 'paused') throw new Error('RECORDING_NOT_PAUSED');
    if (await native!.activeRecording()) throw new Error('RECORDING_BUSY');
    if (!claimAudioCapture(owner)) throw new Error('MICROPHONE_BUSY');
    const profile = useGatewayStore.getState().getActiveProfile();
    const item: LocalRecording = paused ?? {
      id: randomUUID(), recordedAt: Date.now(), state: 'recording',
      ...(profile ? { binding: { gatewayId: profile.gatewayId, deviceId: profile.deviceId, publicKey: profile.gatewayPublicKey } } : {}),
    };
    let indexed = false;
    try {
      if (!(await requestMicPermission()).granted) throw new Error('PERMISSION_DENIED');
      if (AppState.currentState !== 'active') throw new Error('APP_NOT_ACTIVE');
      saveRecording({ ...item, state: 'recording' });
      indexed = true;
      const directory = await native!.startRecording(item.id, labels.title, labels.stop);
      const started = { ...item, directory, state: 'recording' as const };
      saveRecording(started);
      return started;
    } catch (error) {
      if (indexed) saveRecording({ ...item, state: paused ? 'paused' : 'interrupted' });
      releaseAudioCapture(owner);
      throw error;
    }
  });
}

export async function finishRecording(item: LocalRecording, pause = false): Promise<void> {
  return command(async () => {
    if (!loaded) loadRecordings();
    if (!recordingAvailable) throw new Error('NATIVE_BUILD_REQUIRED');
    item = useRecordings.getState().items.find(row => row.id === item.id) ?? item;
    try {
      if (await native!.activeRecording() === item.id) await native!.stopRecording(item.id);
      const chunks = await native!.recordingChunks(item.id);
      const durationMs = chunks.reduce((total, chunk) => total + chunk.sampleCount / 16, 0);
      saveRecording({ ...item, durationMs, state: pause ? 'paused' : 'saved' });
    } finally {
      if (!await native!.activeRecording()) releaseAudioCapture(owner);
    }
  });
}

export async function recordingChunks(item: LocalRecording): Promise<RecordingChunk[]> {
  if (!recordingAvailable) throw new Error('NATIVE_BUILD_REQUIRED');
  if (item.state !== 'saved') throw new Error('RECORDING_NOT_FINISHED');
  return native!.recordingChunks(item.id);
}

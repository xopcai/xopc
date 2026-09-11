import { requireOptionalNativeModule, type NativeModule } from 'expo';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { AppState } from 'react-native';
import { claimAudioCapture, releaseAudioCapture } from './audio-playback-coordinator';

type Subscription = { remove(): void };
export type AudioRouteCapabilities = {
  output: 'receiver' | 'speaker' | 'wired' | 'bluetooth';
  echoControl: 'verified' | 'available' | 'none';
  fullDuplex: boolean;
};
interface VoiceNative extends NativeModule {
  addListener(event: 'pcm', listener: (value: { audio: string; captureId: number }) => void): Subscription;
  addListener(event: 'played', listener: (value: { responseId: string; playedBytes: number }) => void): Subscription;
  addListener(event: 'interrupted', listener: (value: { reason: string }) => void): Subscription;
  addListener(event: 'speechCandidate', listener: (value: { active: boolean; captureId: number }) => void): Subscription;
  addListener(event: 'route', listener: (value: AudioRouteCapabilities) => void): Subscription;
  start(background: boolean, title: string, stopLabel: string): Promise<AudioRouteCapabilities>;
  setCaptureEnabled(enabled: boolean, captureId: number): void;
  enqueue(id: string, audio: string): Promise<void>;
  duck(): Promise<void>;
  resumeOutput(): Promise<void>;
  flush(): Promise<void>;
  stop(): Promise<void>;
  setSpeaker(enabled: boolean): Promise<void>;
}
const native = requireOptionalNativeModule<VoiceNative>('XopcVoice');
export const nativeVoiceAvailable = native !== null;

export function decodePcm(audio: string): Uint8Array {
  const binary = atob(audio);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
export function encodePcm(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export class NativeAudioSession {
  permissionPromptActive = false;
  private owner = Symbol('voice');
  private subscriptions: Subscription[] = [];
  private owned = false;
  private epoch = 0;
  private captureId = 0;
  private capturing = false;
  private cancelPermissionWait?: () => void;

  private waitForPermissionForeground(): Promise<void> {
    if (AppState.currentState !== 'inactive') return Promise.resolve();
    return new Promise(resolve => {
      const finish = () => {
        clearTimeout(timeout);
        subscription.remove();
        this.cancelPermissionWait = undefined;
        resolve();
      };
      const subscription = AppState.addEventListener('change', state => {
        if (state !== 'inactive') finish();
      });
      const timeout = setTimeout(finish, 1500);
      this.cancelPermissionWait = finish;
      if (AppState.currentState !== 'inactive') finish();
    });
  }

  async start(background: boolean, labels: { title: string; end: string }, callbacks: {
    pcm: (bytes: Uint8Array) => void;
    played: (id: string, bytes: number) => void;
    interrupted: (reason: string) => void;
    speechCandidate: (active: boolean) => void;
    route: (capabilities: AudioRouteCapabilities) => void;
  }): Promise<AudioRouteCapabilities> {
    if (!native) throw new Error('NATIVE_BUILD_REQUIRED');
    if (!claimAudioCapture(this.owner)) throw new Error('MICROPHONE_BUSY');
    this.owned = true;
    const epoch = ++this.epoch;
    try {
      let permission = await getRecordingPermissionsAsync();
      if (epoch !== this.epoch) throw new Error('CANCELLED');
      if (!permission.granted) {
        this.permissionPromptActive = true;
        try {
          permission = await requestRecordingPermissionsAsync();
          // iOS resolves permission before the system sheet restores the active app state.
          if (permission.granted && epoch === this.epoch && !background) await this.waitForPermissionForeground();
        }
        finally { this.permissionPromptActive = false; }
      }
      if (!permission.granted) throw new Error('PERMISSION_DENIED');
      if (epoch !== this.epoch) throw new Error('CANCELLED');
      if (!background && AppState.currentState !== 'active') throw new Error('background');
      this.subscriptions = [
        native.addListener('pcm', ({ audio, captureId }) => {
          if (this.capturing && captureId === this.captureId) callbacks.pcm(decodePcm(audio));
        }),
        native.addListener('played', ({ responseId, playedBytes }: { responseId: string; playedBytes: number }) => callbacks.played(responseId, playedBytes)),
        native.addListener('interrupted', ({ reason }: { reason: string }) => callbacks.interrupted(reason)),
        native.addListener('speechCandidate', ({ active, captureId }) => {
          if (this.capturing && captureId === this.captureId) callbacks.speechCandidate(active);
        }),
        native.addListener('route', callbacks.route),
      ];
      return await native.start(background, labels.title, labels.end);
    } catch (error) { await this.stop(); throw error; }
  }
  capture(enabled: boolean): void {
    this.capturing = enabled;
    const captureId = ++this.captureId;
    if (this.owned) native?.setCaptureEnabled(enabled, captureId);
  }
  enqueue(id: string, bytes: Uint8Array): Promise<void> { return this.owned ? native!.enqueue(id, encodePcm(bytes)) : Promise.resolve(); }
  duck(): Promise<void> { return this.owned ? native!.duck() : Promise.resolve(); }
  resumeOutput(): Promise<void> { return this.owned ? native!.resumeOutput() : Promise.resolve(); }
  flush(): Promise<void> { return this.owned ? native!.flush() : Promise.resolve(); }
  speaker(enabled: boolean): Promise<void> { return native?.setSpeaker(enabled) ?? Promise.resolve(); }
  async stop(): Promise<void> {
    ++this.epoch;
    this.cancelPermissionWait?.();
    this.capture(false);
    this.subscriptions.forEach(s => s.remove());
    this.subscriptions = [];
    if (!this.owned) return;
    try { await native?.stop(); }
    finally { releaseAudioCapture(this.owner); this.owned = false; }
  }
}

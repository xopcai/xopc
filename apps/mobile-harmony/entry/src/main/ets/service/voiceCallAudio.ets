import { abilityAccessCtrl, common, wantAgent } from '@kit.AbilityKit';
import { audio } from '@kit.AudioKit';
import { avSession } from '@kit.AVSessionKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';

export interface XopcVoiceAudioCallbacks {
  onInput: (bytes: Uint8Array) => void;
  onSpeech: (active: boolean) => void;
  onPlayed: (responseId: string, milliseconds: number) => void;
  onRoute: (name: string) => void;
  onFailure: (reason: string) => void;
}

export class XopcVoiceCallAudio {
  private capturer?: audio.AudioCapturer;
  private renderer?: audio.AudioRenderer;
  private callbacks?: XopcVoiceAudioCallbacks;
  private generation: number = 0;
  private capturing: boolean = false;
  private muted: boolean = false;
  private speaker: boolean = false;
  private speech: boolean = false;
  private speechFrames: number = 0;
  private silentFrames: number = 0;
  private responseId: string = '';
  private playedMs: number = 0;
  private playback: Promise<void> = Promise.resolve();
  private context?: common.UIAbilityContext;
  private session?: avSession.AVSession;
  private backgroundRunning: boolean = false;

  async start(context: common.UIAbilityContext, background: boolean, callbacks: XopcVoiceAudioCallbacks): Promise<void> {
    await this.stop();
    const permission = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context,
      ['ohos.permission.MICROPHONE']);
    if (permission.authResults[0] !== 0) throw new Error('MICROPHONE_PERMISSION_REQUIRED');
    const generation = ++this.generation;
    this.context = context; this.callbacks = callbacks; this.muted = false; this.speaker = false;
    const input: audio.AudioStreamInfo = { samplingRate: 16000, channels: audio.AudioChannel.CHANNEL_1,
      sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE, encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW };
    const output: audio.AudioStreamInfo = { samplingRate: 24000, channels: audio.AudioChannel.CHANNEL_1,
      sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE, encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW };
    try {
      this.renderer = await audio.createAudioRenderer({ streamInfo: output,
        rendererInfo: { usage: audio.StreamUsage.STREAM_USAGE_VOICE_COMMUNICATION, rendererFlags: 0 },
        privacyType: audio.AudioPrivacyType.PRIVACY_TYPE_PRIVATE });
      this.capturer = await audio.createAudioCapturer({ streamInfo: input,
        capturerInfo: { source: audio.SourceType.SOURCE_TYPE_VOICE_COMMUNICATION, capturerFlags: 0 } });
      this.renderer.setInterruptModeSync(audio.InterruptMode.INDEPENDENT_MODE);
      this.renderer.on('audioInterrupt', (event: audio.InterruptEvent): void => {
        if (generation === this.generation && event.hintType === audio.InterruptHint.INTERRUPT_HINT_STOP) callbacks.onFailure('AUDIO_INTERRUPTED');
      });
      this.renderer.on('outputDeviceChange', (devices: audio.AudioDeviceDescriptors): void => {
        if (generation === this.generation) callbacks.onRoute(this.routeName(devices));
      });
      this.capturer.on('audioInterrupt', (_event: audio.InterruptEvent): void => {
        if (generation === this.generation) callbacks.onFailure('CAPTURE_INTERRUPTED');
      });
      await this.renderer.start();
      await this.capturer.start();
      if (background) await this.startMediaSession(context, generation);
      this.capturing = true;
      callbacks.onRoute(this.routeName(await this.renderer.getCurrentOutputDevices()));
      this.captureLoop(generation);
    } catch (error) {
      await this.stop(); throw error as Error;
    }
  }

  private async startMediaSession(context: common.UIAbilityContext, generation: number): Promise<void> {
    try {
      const session = await avSession.createAVSession(context, 'xopc-live-voice', 'audio');
      if (generation !== this.generation) { await session.destroy(); return; }
      this.session = session;
      session.on('stop', (): void => { if (generation === this.generation) this.callbacks?.onFailure('ended'); });
      await session.setAVMetadata({ assetId: 'xopc-live-voice', title: 'xopc', artist: 'Live voice' });
      await session.setAVPlaybackState({ state: avSession.PlaybackState.PLAYBACK_STATE_PLAY, speed: 1,
        position: { elapsedTime: 0, updateTime: Date.now() } });
      await session.activate();
      const agent = await wantAgent.getWantAgent({
        wants: [{ bundleName: 'ai.xopc.mobile', abilityName: 'EntryAbility' }],
        actionType: wantAgent.OperationType.START_ABILITY, requestCode: 2,
        actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
      });
      await backgroundTaskManager.startBackgroundRunning(context, ['audioPlayback', 'audioRecording'], agent);
      this.backgroundRunning = generation === this.generation;
      if (!this.backgroundRunning) await backgroundTaskManager.stopBackgroundRunning(context);
    } catch (_error) {
      // The call remains available in the foreground if the media notification cannot be created.
    }
  }

  private async captureLoop(generation: number): Promise<void> {
    const capturer = this.capturer;
    if (!capturer) return;
    const size = Math.max(640, capturer.getBufferSizeSync());
    try {
      while (generation === this.generation && this.capturing) {
        const data = await capturer.read(size, true);
        if (generation !== this.generation || !this.capturing) return;
        const bytes = new Uint8Array(data);
        this.detectSpeech(bytes);
        if (!this.muted && bytes.byteLength) this.callbacks?.onInput(bytes);
      }
    } catch (_error) {
      if (generation === this.generation && this.capturing) this.callbacks?.onFailure('CAPTURE_FAILED');
    }
  }

  private detectSpeech(bytes: Uint8Array): void {
    if (bytes.byteLength < 2) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let power = 0;
    for (let offset = 0; offset + 1 < bytes.byteLength; offset += 2) power += Math.abs(view.getInt16(offset, true));
    const average = power / (bytes.byteLength / 2);
    if (average > 950) { this.speechFrames++; this.silentFrames = 0; }
    else { this.silentFrames++; this.speechFrames = 0; }
    if (!this.speech && this.speechFrames >= 3) { this.speech = true; this.callbacks?.onSpeech(true); }
    if (this.speech && this.silentFrames >= 12) { this.speech = false; this.callbacks?.onSpeech(false); }
  }

  setMuted(value: boolean): void { this.muted = value; }

  async setSpeaker(value: boolean): Promise<void> {
    this.speaker = value;
    const manager = audio.getAudioManager();
    await manager.getRoutingManager().setCommunicationDevice(audio.CommunicationDeviceType.SPEAKER, value);
    const renderer = this.renderer;
    if (renderer) this.callbacks?.onRoute(this.routeName(await renderer.getCurrentOutputDevices()));
  }

  async setDucked(value: boolean): Promise<void> {
    try { await this.renderer?.setVolume(value ? 0.25 : 1); } catch (_error) {}
  }

  enqueue(responseId: string, bytes: Uint8Array): void {
    const generation = this.generation;
    this.playback = this.playback.then(async (): Promise<void> => {
      const renderer = this.renderer;
      if (generation !== this.generation || !renderer) return;
      if (this.responseId !== responseId) { this.responseId = responseId; this.playedMs = 0; }
      const copy = bytes.slice();
      const written = await renderer.write(copy.buffer);
      if (generation !== this.generation || written <= 0) return;
      this.playedMs += Math.round(written / 48);
      this.callbacks?.onPlayed(responseId, this.playedMs);
    }).catch((_error: Error): void => {
      if (generation === this.generation) this.callbacks?.onFailure('PLAYBACK_FAILED');
    });
  }

  async flush(): Promise<void> {
    this.responseId = ''; this.playedMs = 0;
    try { await this.renderer?.flush(); } catch (_error) {}
  }

  private routeName(devices: audio.AudioDeviceDescriptors): string {
    const type = devices.length ? devices[0].deviceType : audio.DeviceType.INVALID;
    if (type === audio.DeviceType.SPEAKER) return 'speaker';
    if (type === audio.DeviceType.EARPIECE) return 'earpiece';
    if (type === audio.DeviceType.BLUETOOTH_A2DP || type === audio.DeviceType.BLUETOOTH_SCO) return 'bluetooth';
    if (type === audio.DeviceType.WIRED_HEADSET || type === audio.DeviceType.USB_HEADSET) return 'headset';
    return this.speaker ? 'speaker' : 'system';
  }

  async stop(): Promise<void> {
    ++this.generation; this.capturing = false; this.speech = false; this.speechFrames = 0; this.silentFrames = 0;
    const capturer = this.capturer; const renderer = this.renderer;
    const context = this.context; const session = this.session; const backgroundRunning = this.backgroundRunning;
    this.capturer = undefined; this.renderer = undefined; this.callbacks = undefined;
    this.context = undefined; this.session = undefined; this.backgroundRunning = false;
    if (capturer) { try { await capturer.stop(); } catch (_error) {} try { await capturer.release(); } catch (_error) {} }
    if (renderer) { try { renderer.off('audioInterrupt'); renderer.off('outputDeviceChange'); } catch (_error) {}
      try { await renderer.stop(); } catch (_error) {} try { await renderer.release(); } catch (_error) {} }
    if (session) { try { await session.setAVPlaybackState({ state: avSession.PlaybackState.PLAYBACK_STATE_STOP }); } catch (_error) {}
      try { await session.deactivate(); } catch (_error) {} try { await session.destroy(); } catch (_error) {} }
    if (context && backgroundRunning) { try { await backgroundTaskManager.stopBackgroundRunning(context); } catch (_error) {} }
  }
}

export const voiceCallAudio: XopcVoiceCallAudio = new XopcVoiceCallAudio();

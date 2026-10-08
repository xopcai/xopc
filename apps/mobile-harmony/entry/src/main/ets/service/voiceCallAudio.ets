import { abilityAccessCtrl, common, wantAgent } from '@kit.AbilityKit';
import { audio } from '@kit.AudioKit';
import { avSession } from '@kit.AVSessionKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

export interface XopcVoiceAudioCallbacks {
  onInput: (bytes: Uint8Array) => void;
  onBuffered: (responseId: string, milliseconds: number) => void;
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
  private responseId: string = '';
  private playedMs: number = 0;
  private writtenMs: number = 0;
  private playbackGeneration: number = 0;
  private playbackTimer: number = -1;
  private frameBase: number = 0;
  private lastFramePosition: number = 0;
  private playbackPositionAvailable: boolean = true;
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
        if (generation === this.generation && event.hintType === audio.InterruptHint.INTERRUPT_HINT_STOP) {
          hilog.warn(0x0000, 'XopcVoice', 'Voice playback interrupted'); callbacks.onFailure('AUDIO_INTERRUPTED');
        }
      });
      this.renderer.on('outputDeviceChange', (devices: audio.AudioDeviceDescriptors): void => {
        if (generation === this.generation) callbacks.onRoute(this.routeName(devices));
      });
      this.capturer.on('audioInterrupt', (_event: audio.InterruptEvent): void => {
        if (generation === this.generation) { hilog.warn(0x0000, 'XopcVoice', 'Voice capture interrupted'); callbacks.onFailure('CAPTURE_INTERRUPTED'); }
      });
      await this.renderer.start();
      await this.capturer.start();
      if (background) await this.startMediaSession(context, generation);
      this.capturing = true;
      callbacks.onRoute(this.routeName(await this.renderer.getCurrentOutputDevices()));
      this.captureLoop(generation);
    } catch (error) {
      hilog.warn(0x0000, 'XopcVoice', 'Voice audio setup failed: %{public}s', (error as Error).message);
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
        if (!this.muted && bytes.byteLength) this.callbacks?.onInput(bytes);
      }
    } catch (error) {
      if (generation === this.generation && this.capturing) {
        hilog.warn(0x0000, 'XopcVoice', 'Voice capture failed: %{public}s', (error as Error).message);
        this.callbacks?.onFailure('CAPTURE_FAILED');
      }
    }
  }

  setMuted(value: boolean): void { this.muted = value; }

  async setSpeaker(value: boolean): Promise<void> {
    this.speaker = value;
    const manager = audio.getAudioManager();
    await manager.getRoutingManager().setCommunicationDevice(audio.CommunicationDeviceType.SPEAKER, value);
    const renderer = this.renderer;
    if (renderer) this.callbacks?.onRoute(this.routeName(await renderer.getCurrentOutputDevices()));
  }

  enqueue(responseId: string, bytes: Uint8Array): void {
    const generation = this.generation;
    const playbackGeneration = this.playbackGeneration;
    const copy = bytes.slice();
    this.playback = this.playback.then(async (): Promise<void> => {
      const renderer = this.renderer;
      if (generation !== this.generation || playbackGeneration !== this.playbackGeneration || !renderer) return;
      if (this.responseId !== responseId) {
        this.responseId = responseId; this.playedMs = 0; this.writtenMs = 0;
        this.playbackPositionAvailable = true;
        try {
          this.frameBase = renderer.getAudioTimestampInfoSync().framePos;
          this.lastFramePosition = this.frameBase;
        } catch (_error) { this.playbackPositionAvailable = false; }
      }
      let offset = 0;
      while (offset < copy.byteLength) {
        if (generation !== this.generation || playbackGeneration !== this.playbackGeneration) return;
        const remaining = copy.slice(offset);
        const written = await renderer.write(remaining.buffer);
        if (written <= 0) throw new Error('Incomplete voice playback write');
        offset += written;
        if (generation !== this.generation || playbackGeneration !== this.playbackGeneration) return;
        this.writtenMs += written / 48;
        this.callbacks?.onBuffered(responseId, Math.floor(this.writtenMs));
        try { this.updatePlayed(renderer, responseId); }
        catch (_error) { this.playbackPositionAvailable = false; this.clearPlaybackTimer(); }
      }
      this.startPlaybackTimer(generation, playbackGeneration);
    }).catch((error: Error): void => {
      if (generation === this.generation && playbackGeneration === this.playbackGeneration) {
        hilog.warn(0x0000, 'XopcVoice', 'Voice playback failed: %{public}s', error.message);
        this.callbacks?.onFailure('PLAYBACK_FAILED');
      }
    });
  }

  finish(responseId: string): void {
    const generation = this.generation;
    const playbackGeneration = this.playbackGeneration;
    void this.playback.then(async (): Promise<void> => {
      const renderer = this.renderer;
      if (generation !== this.generation || playbackGeneration !== this.playbackGeneration || !renderer || this.responseId !== responseId) return;
      this.clearPlaybackTimer();
      let timer: number = -1;
      try {
        await Promise.race<void>([renderer.drain(), new Promise<void>((_resolve, reject): void => {
          timer = setTimeout((): void => reject(new Error('Voice playback drain timed out')), 15_000);
        })]);
      } finally { if (timer !== -1) clearTimeout(timer); }
      if (generation !== this.generation || playbackGeneration !== this.playbackGeneration || this.responseId !== responseId) return;
      this.clearPlaybackTimer();
      this.playedMs = Math.floor(this.writtenMs);
      this.callbacks?.onPlayed(responseId, this.playedMs);
    }).catch((error: Error): void => {
      if (generation === this.generation && playbackGeneration === this.playbackGeneration) {
        hilog.warn(0x0000, 'XopcVoice', 'Voice playback drain failed: %{public}s', error.message);
        this.callbacks?.onFailure('PLAYBACK_FAILED');
      }
    });
  }

  private startPlaybackTimer(generation: number, playbackGeneration: number): void {
    if (this.playbackTimer !== -1 || !this.playbackPositionAvailable) return;
    this.playbackTimer = setInterval((): void => {
      const renderer = this.renderer;
      if (generation !== this.generation || playbackGeneration !== this.playbackGeneration || !renderer || !this.responseId) {
        this.clearPlaybackTimer(); return;
      }
      try { this.updatePlayed(renderer, this.responseId); }
      catch (_error) { this.playbackPositionAvailable = false; this.clearPlaybackTimer(); }
    }, 40);
  }

  private updatePlayed(renderer: audio.AudioRenderer, responseId: string): void {
    if (!this.playbackPositionAvailable) return;
    const framePosition = renderer.getAudioTimestampInfoSync().framePos;
    if (framePosition < this.lastFramePosition) this.frameBase -= this.lastFramePosition;
    this.lastFramePosition = framePosition;
    const milliseconds = Math.min(Math.floor(this.writtenMs), Math.floor((framePosition - this.frameBase) / 24));
    if (milliseconds <= this.playedMs) return;
    this.playedMs = milliseconds;
    this.callbacks?.onPlayed(responseId, milliseconds);
    if (this.playedMs >= this.writtenMs) this.clearPlaybackTimer();
  }

  private clearPlaybackTimer(): void {
    if (this.playbackTimer !== -1) clearInterval(this.playbackTimer);
    this.playbackTimer = -1;
  }

  async flush(): Promise<void> {
    ++this.playbackGeneration; this.clearPlaybackTimer();
    this.responseId = ''; this.playedMs = 0; this.writtenMs = 0;
    this.playback = this.playback.then(async (): Promise<void> => {
      try { await this.renderer?.flush(); } catch (_error) {}
    });
    await this.playback;
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
    ++this.generation; ++this.playbackGeneration; this.clearPlaybackTimer();
    this.capturing = false;
    this.responseId = ''; this.playedMs = 0; this.writtenMs = 0;
    const capturer = this.capturer; const renderer = this.renderer;
    const context = this.context; const session = this.session; const backgroundRunning = this.backgroundRunning;
    this.capturer = undefined; this.renderer = undefined; this.callbacks = undefined;
    this.context = undefined; this.session = undefined; this.backgroundRunning = false;
    if (capturer) { try { capturer.off('audioInterrupt'); } catch (_error) {}
      try { await capturer.stop(); } catch (_error) {} try { await capturer.release(); } catch (_error) {} }
    if (renderer) { try { renderer.off('audioInterrupt'); renderer.off('outputDeviceChange'); } catch (_error) {}
      try { await renderer.stop(); } catch (_error) {} try { await renderer.release(); } catch (_error) {} }
    if (session) { try { await session.setAVPlaybackState({ state: avSession.PlaybackState.PLAYBACK_STATE_STOP }); } catch (_error) {}
      try { await session.deactivate(); } catch (_error) {} try { await session.destroy(); } catch (_error) {} }
    if (context && backgroundRunning) { try { await backgroundTaskManager.stopBackgroundRunning(context); } catch (_error) {} }
  }
}

export const voiceCallAudio: XopcVoiceCallAudio = new XopcVoiceCallAudio();

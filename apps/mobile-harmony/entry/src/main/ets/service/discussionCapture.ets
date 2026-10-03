import { abilityAccessCtrl, common, wantAgent } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { audio } from '@kit.AudioKit';
import { avSession } from '@kit.AVSessionKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { xopcAudioLevel, xopcPcm16Wav, xopcPcmDurationMs } from '../common/discussionAudio';
import { XopcDiscussionCapturePhase, XopcDiscussionRecordingManifest,
  XopcDiscussionTranscript } from '../model/discussionCapture';
import { XopcDiscussionCaptureRepository } from '../repository/discussionCaptureRepository';
import { XopcDiscussionLiveTranscription } from './discussionLiveTranscription';

const XOPC_CAPTURE_SEGMENT_BYTES: number = 96000;
const XOPC_CAPTURE_MAX_MS: number = 120 * 60 * 1000;

interface XopcPendingCaptureChunk {
  sequence: number;
  startedAtMs: number;
  endedAtMs: number;
  path: string;
  wav: Uint8Array;
}

@ObservedV2
export class XopcDiscussionCapture {
  @Trace phase: XopcDiscussionCapturePhase = 'idle';
  @Trace elapsedMs: number = 0;
  @Trace level: number = 0;
  @Trace transcript: string = '';
  @Trace realtimeTranscript: string = '';
  @Trace realtimeActive: boolean = false;
  @Trace transcriptPending: boolean = false;
  @Trace error: string = '';
  @Trace noteId: string = '';
  @Trace markers: number[] = [];
  private repository: XopcDiscussionCaptureRepository = new XopcDiscussionCaptureRepository();
  private capturer?: audio.AudioCapturer;
  private context?: common.UIAbilityContext;
  private session?: avSession.AVSession;
  private discussionId: string = '';
  private generation: number = 0;
  private sequence: number = 0;
  private pcmParts: Uint8Array[] = [];
  private pcmBytes: number = 0;
  private capturedBytes: number = 0;
  private pending: XopcPendingCaptureChunk[] = [];
  private uploadQueue: Promise<void> = Promise.resolve();
  private captureTask: Promise<void> = Promise.resolve();
  private pollTimer: number = -1;
  private clockTimer: number = -1;
  private limitTimer: number = -1;
  private capturing: boolean = false;
  private backgroundRunning: boolean = false;
  private live?: XopcDiscussionLiveTranscription;

  get visibleTranscript(): string {
    const realtime = this.realtimeTranscript.trim(); const durable = this.transcript.trim();
    if (this.realtimeActive) return realtime || durable;
    return durable.length >= realtime.length ? durable : realtime;
  }

  get active(): boolean {
    return this.phase === 'starting' || this.phase === 'recording' || this.phase === 'paused' ||
      this.phase === 'stopping' || this.phase === 'organizing' || (this.phase === 'error' && !!this.discussionId);
  }

  async consentVersion(): Promise<number | undefined> {
    const settings = await this.repository.settings();
    return settings.consentAcknowledgedAt ? undefined : settings.consentPolicyVersion;
  }

  async acknowledge(version: number): Promise<void> { await this.repository.acknowledge(version); }

  async start(context: common.UIAbilityContext): Promise<void> {
    if (this.phase !== 'idle' && this.phase !== 'completed' && this.phase !== 'error') return;
    const generation = ++this.generation;
    this.phase = 'starting'; this.error = ''; this.transcript = ''; this.realtimeTranscript = '';
    this.realtimeActive = false; this.noteId = ''; this.markers = [];
    this.elapsedMs = 0; this.level = 0; this.sequence = 0; this.capturedBytes = 0; this.pcmBytes = 0;
    this.pcmParts = []; this.pending = []; this.context = context; this.discussionId = '';
    try {
      const settings = await this.repository.settings();
      if (!settings.consentAcknowledgedAt) throw new Error('CONSENT_REQUIRED:' + settings.consentPolicyVersion);
      const permission = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context,
        ['ohos.permission.MICROPHONE']);
      if (generation !== this.generation) return;
      if (permission.authResults[0] !== 0) throw new Error('MICROPHONE_PERMISSION_REQUIRED');
      const detail = await this.repository.create(util.generateRandomUUID(), settings.consentPolicyVersion);
      if (generation !== this.generation) return;
      this.discussionId = detail.discussion.id; this.noteId = detail.discussion.noteId;
      const streamInfo: audio.AudioStreamInfo = { samplingRate: 16000, channels: audio.AudioChannel.CHANNEL_1,
        sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE, encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW };
      this.capturer = await audio.createAudioCapturer({ streamInfo,
        capturerInfo: { source: audio.SourceType.SOURCE_TYPE_MIC, capturerFlags: 0 } });
      this.capturer.on('audioInterrupt', (_event: audio.InterruptEvent): void => {
        if (generation === this.generation && this.capturing) void this.fail('CAPTURE_INTERRUPTED');
      });
      await this.capturer.start();
      await this.startBackground(context, generation);
      if (generation !== this.generation) return;
      this.capturing = true; this.phase = 'recording'; this.startTimers(generation);
      this.startRealtime(generation);
      this.captureTask = this.captureLoop(generation);
    } catch (caught) {
      if (generation === this.generation) { this.error = (caught as Error).message; this.phase = 'error'; }
      if (this.discussionId && !this.capturedBytes) {
        try { await this.repository.cancel(this.discussionId); } catch (_error) {}
        this.discussionId = ''; this.noteId = '';
      }
      await this.releaseAudio();
      throw caught as Error;
    }
  }

  togglePause(): void {
    if (this.phase === 'recording') { this.phase = 'paused'; this.level = 0; }
    else if (this.phase === 'paused') this.phase = 'recording';
  }

  mark(): void {
    if (this.phase === 'recording' || this.phase === 'paused') this.markers = this.markers.concat([this.elapsedMs]);
  }

  async stop(): Promise<string> {
    if (this.phase !== 'recording' && this.phase !== 'paused' && this.phase !== 'error') return this.noteId;
    if (!this.discussionId) return this.noteId;
    this.phase = 'stopping'; this.clearTimers(); this.capturing = false; this.level = 0;
    this.live?.commit();
    const capturer = this.capturer;
    if (capturer) { try { await capturer.stop(); } catch (_error) {} }
    try { await this.captureTask; } catch (_error) {}
    this.flushChunk();
    await this.uploadQueue;
    if (this.pending.length) {
      const retry = this.pending.slice();
      for (const chunk of retry) await this.uploadChunk(chunk);
    }
    if (this.pending.length) {
      this.error = 'CAPTURE_UPLOAD_PENDING'; this.phase = 'error';
      await this.releaseAudio(); await this.releaseRealtime('surface_closed'); return this.noteId;
    }
    this.phase = 'organizing';
    const manifest: XopcDiscussionRecordingManifest = { lastSequence: this.sequence - 1, chunkCount: this.sequence,
      mimeType: 'audio/wav', fileName: 'voice-note-' + Date.now() + '.wav', containerMode: 'independent_wav' };
    try {
      await this.repository.seal(this.discussionId, manifest);
      await this.refreshTranscript(); this.phase = 'completed';
    } catch (caught) { this.error = (caught as Error).message; this.phase = 'error'; }
    await this.releaseAudio();
    await this.releaseRealtime('user_finished');
    return this.noteId;
  }

  async discard(): Promise<void> {
    ++this.generation; this.capturing = false; this.clearTimers();
    await this.releaseAudio(); await this.releaseRealtime('surface_closed');
    if (this.discussionId) { try { await this.repository.cancel(this.discussionId); } catch (_error) {} }
    for (const chunk of this.pending) { try { await fs.unlink(chunk.path); } catch (_error) {} }
    this.pending = []; this.pcmParts = []; this.pcmBytes = 0; this.discussionId = ''; this.noteId = ''; this.context = undefined;
    this.phase = 'idle'; this.error = ''; this.transcript = ''; this.realtimeTranscript = ''; this.realtimeActive = false;
    this.elapsedMs = 0; this.level = 0; this.markers = [];
  }

  reset(): void {
    if (this.active) return;
    this.phase = 'idle'; this.error = ''; this.transcript = ''; this.realtimeTranscript = ''; this.realtimeActive = false;
    this.noteId = ''; this.elapsedMs = 0;
    this.level = 0; this.markers = []; this.discussionId = ''; this.context = undefined;
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
        if (this.phase === 'paused' || !bytes.byteLength) continue;
        const copy = bytes.slice();
        this.pcmParts.push(copy); this.pcmBytes += copy.byteLength; this.capturedBytes += copy.byteLength;
        this.live?.audio(copy);
        this.level = xopcAudioLevel(copy);
        if (this.pcmBytes >= XOPC_CAPTURE_SEGMENT_BYTES) this.flushChunk();
      }
    } catch (caught) {
      if (generation === this.generation && this.capturing) await this.fail((caught as Error).message || 'CAPTURE_FAILED');
    }
  }

  private flushChunk(): void {
    if (!this.pcmBytes || !this.discussionId || !this.context) return;
    const endedAtMs = xopcPcmDurationMs(this.capturedBytes);
    const startedAtMs = endedAtMs - xopcPcmDurationMs(this.pcmBytes);
    const wav = xopcPcm16Wav(this.pcmParts);
    const sequence = this.sequence++;
    const path = this.context.cacheDir + '/xopc-capture-' + this.discussionId + '-' + sequence + '.wav';
    const chunk: XopcPendingCaptureChunk = { sequence, startedAtMs, endedAtMs, path, wav };
    this.pending.push(chunk); this.pcmParts = []; this.pcmBytes = 0; this.transcriptPending = true;
    this.uploadQueue = this.uploadQueue.then(async (): Promise<void> => { await this.uploadChunk(chunk); });
  }

  private async uploadChunk(chunk: XopcPendingCaptureChunk): Promise<void> {
    try {
      await this.writeChunk(chunk);
      const transcript = await this.repository.upload(this.discussionId, chunk.sequence, chunk.wav,
        chunk.startedAtMs, chunk.endedAtMs);
      this.applyTranscript(transcript);
      this.pending = this.pending.filter((item: XopcPendingCaptureChunk): boolean => item.sequence !== chunk.sequence);
      try { await fs.unlink(chunk.path); } catch (_error) {}
    } catch (caught) {
      hilog.warn(0x0000, 'XopcCapture', 'Capture segment upload delayed: %{public}s', (caught as Error).message);
      this.error = 'LIVE_TRANSCRIPTION_DELAYED';
    } finally { this.transcriptPending = this.pending.length > 0; }
  }

  private async writeChunk(chunk: XopcPendingCaptureChunk): Promise<void> {
    let output: fs.File | undefined = undefined;
    try {
      output = await fs.open(chunk.path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
      const data = chunk.wav.buffer.slice(chunk.wav.byteOffset, chunk.wav.byteOffset + chunk.wav.byteLength);
      if (await fs.write(output.fd, data) !== chunk.wav.byteLength) throw new Error('INCOMPLETE_CAPTURE_WRITE');
    } finally { if (output) await fs.close(output); }
  }

  private applyTranscript(value: XopcDiscussionTranscript): void {
    this.transcript = value.text.trim();
    if (this.transcript) this.error = '';
  }

  private async refreshTranscript(): Promise<void> {
    if (!this.discussionId) return;
    try { this.applyTranscript(await this.repository.transcript(this.discussionId)); }
    catch (_error) { /* Recording remains authoritative when live transcription is temporarily unavailable. */ }
  }

  private startTimers(generation: number): void {
    this.clockTimer = setInterval((): void => {
      if (generation === this.generation) this.elapsedMs = xopcPcmDurationMs(this.capturedBytes);
    }, 250);
    this.pollTimer = setInterval((): void => { if (generation === this.generation && !this.realtimeActive)
      void this.refreshTranscript(); }, 800);
    this.limitTimer = setTimeout((): void => { if (generation === this.generation) void this.stop(); }, XOPC_CAPTURE_MAX_MS);
  }

  private clearTimers(): void {
    if (this.clockTimer !== -1) clearInterval(this.clockTimer);
    if (this.pollTimer !== -1) clearInterval(this.pollTimer);
    if (this.limitTimer !== -1) clearTimeout(this.limitTimer);
    this.clockTimer = -1; this.pollTimer = -1; this.limitTimer = -1;
  }

  private async startBackground(context: common.UIAbilityContext, generation: number): Promise<void> {
    try {
      const session = await avSession.createAVSession(context, 'xopc-voice-note', 'audio');
      if (generation !== this.generation) { await session.destroy(); return; }
      this.session = session;
      session.on('stop', (): void => { if (generation === this.generation) void this.stop(); });
      await session.setAVMetadata({ assetId: 'xopc-voice-note', title: 'xopc', artist: 'Voice note' });
      await session.setAVPlaybackState({ state: avSession.PlaybackState.PLAYBACK_STATE_PLAY, speed: 1,
        position: { elapsedTime: 0, updateTime: Date.now() } });
      await session.activate();
      const agent = await wantAgent.getWantAgent({ wants: [{ bundleName: 'ai.xopc.mobile', abilityName: 'EntryAbility' }],
        actionType: wantAgent.OperationType.START_ABILITY, requestCode: 3,
        actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG] });
      await backgroundTaskManager.startBackgroundRunning(context, ['audioRecording'], agent);
      this.backgroundRunning = generation === this.generation;
    } catch (_error) { /* Foreground capture remains available when the notification cannot be created. */ }
  }

  private async fail(reason: string): Promise<void> {
    this.error = reason; this.phase = 'error'; this.capturing = false; this.clearTimers();
    await this.releaseAudio(); await this.releaseRealtime('surface_closed');
  }

  private startRealtime(generation: number): void {
    const live = new XopcDiscussionLiveTranscription({
      onTranscript: (text: string): void => { if (generation === this.generation) this.realtimeTranscript = text; },
      onAvailability: (available: boolean): void => { if (generation === this.generation) this.realtimeActive = available; }
    });
    this.live = live;
    void live.start();
  }

  private async releaseRealtime(reason: 'user_finished' | 'surface_closed'): Promise<void> {
    const live = this.live; this.live = undefined; this.realtimeActive = false;
    await live?.close(reason);
  }

  private async releaseAudio(): Promise<void> {
    this.clearTimers(); this.capturing = false;
    const capturer = this.capturer; const session = this.session; const context = this.context;
    const backgroundRunning = this.backgroundRunning;
    this.capturer = undefined; this.session = undefined; this.backgroundRunning = false;
    if (capturer) {
      try { capturer.off('audioInterrupt'); } catch (_error) {}
      try { await capturer.stop(); } catch (_error) {}
      try { await capturer.release(); } catch (_error) {}
    }
    if (session) {
      try { await session.setAVPlaybackState({ state: avSession.PlaybackState.PLAYBACK_STATE_STOP }); } catch (_error) {}
      try { await session.deactivate(); } catch (_error) {}
      try { await session.destroy(); } catch (_error) {}
    }
    if (context && backgroundRunning) {
      try { await backgroundTaskManager.stopBackgroundRunning(context); } catch (_error) {}
    }
  }
}

export const discussionCapture: XopcDiscussionCapture = new XopcDiscussionCapture();

import { abilityAccessCtrl, common, wantAgent } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { audio } from '@kit.AudioKit';
import { avSession } from '@kit.AVSessionKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { xopcAudioLevel, xopcPcm16Wav, xopcPcmDurationMs } from '../common/discussionAudio';
import { XopcDiscussionCapturePhase, XopcDiscussionRecordingManifest,
  XopcDiscussionTranscript } from '../model/discussionCapture';
import { XopcDiscussionCaptureRepository } from '../repository/discussionCaptureRepository';
import { XopcDiscussionLiveTranscription } from './discussionLiveTranscription';
import { XopcDiscussionRecordingStore, XopcLocalRecording } from './discussionRecordingStore';
import { gatewaySession } from './gatewaySession';

const XOPC_CAPTURE_SEGMENT_BYTES: number = 96000;
const XOPC_CAPTURE_MAX_MS: number = 120 * 60 * 1000;

function xopcCaptureShutdown(task: Promise<void>): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    const timer = setTimeout(resolve, 1500);
    const finish = (): void => { clearTimeout(timer); resolve(); };
    task.then(finish, finish);
  });
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
  @Trace savedDurationMs: number = 0;
  @Trace recovered: boolean = false;
  @Trace backgroundAvailable: boolean = false;
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
  private localStore: XopcDiscussionRecordingStore = new XopcDiscussionRecordingStore();
  private localSession?: XopcLocalRecording;
  private uploadTask?: Promise<void>;
  private uploadRequested: boolean = false;
  private liveUploadTask?: Promise<void>;
  private localFinishTask?: Promise<void>;
  private stopTask?: Promise<string>;
  private storageFailed: boolean = false;
  private writeTask?: Promise<void>;
  private starting: boolean = false;
  private captureTask: Promise<void> = Promise.resolve();
  private pollTimer: number = -1;
  private clockTimer: number = -1;
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
      this.phase === 'stopping' || this.phase === 'organizing' || (this.phase === 'error' && !!this.localSession);
  }

  async restore(context: common.UIAbilityContext): Promise<void> {
    if (this.active) return;
    await this.localStore.initialize(context);
    const gatewayId = gatewaySession.currentProfile()?.gatewayId;
    if (!gatewayId) return;
    const sessions = await this.localStore.pending(gatewayId);
    let session: XopcLocalRecording | undefined = undefined;
    for (const candidate of sessions) {
      if (candidate.noteId) {
        try {
          const detail = await this.repository.byNote(candidate.noteId);
          if (detail.discussion.audioAttachmentId) { await this.localStore.remove(candidate.id); continue; }
        } catch (_error) { /* Local audio remains available while offline. */ }
      }
      session = candidate; break;
    }
    if (!session) return;
    this.context = context; this.localSession = session;
    this.discussionId = session.discussionId; this.noteId = session.noteId; this.markers = session.markers;
    this.recovered = true; this.phase = 'error';
    const chunks = await this.localStore.chunks(session.id).catch((caught: Error) => {
      this.error = caught.message; throw caught;
    });
    this.sequence = chunks.length;
    this.savedDurationMs = chunks.length ? chunks[chunks.length - 1].endedAtMs : 0;
    this.elapsedMs = this.savedDurationMs; this.capturedBytes = this.savedDurationMs * 32;
    this.pcmParts = []; this.pcmBytes = 0; this.storageFailed = false;
    this.recovered = true; this.error = 'CAPTURE_RECOVERED'; this.phase = 'error';
  }

  async consentVersion(): Promise<number | undefined> {
    const settings = await this.repository.settings();
    return settings.consentAcknowledgedAt ? undefined : settings.consentPolicyVersion;
  }

  async acknowledge(version: number): Promise<void> {
    await this.repository.acknowledge(version);
    const gatewayId = gatewaySession.currentProfile()?.gatewayId;
    if (gatewayId) await this.localStore.saveConsent(gatewayId, version);
  }

  async start(context: common.UIAbilityContext): Promise<void> {
    if (this.active || this.stopTask || this.starting) return;
    this.starting = true;
    try { await this.begin(context); } finally { this.starting = false; }
  }

  private async begin(context: common.UIAbilityContext): Promise<void> {
    await this.restore(context);
    if (this.active) return;
    const generation = ++this.generation;
    this.phase = 'starting'; this.error = ''; this.transcript = ''; this.realtimeTranscript = '';
    this.realtimeActive = false; this.noteId = ''; this.markers = []; this.recovered = false;
    this.elapsedMs = 0; this.savedDurationMs = 0; this.level = 0; this.sequence = 0; this.capturedBytes = 0; this.pcmBytes = 0;
    this.pcmParts = []; this.context = context; this.discussionId = ''; this.storageFailed = false;
    this.localFinishTask = undefined;
    try {
      const gatewayId = gatewaySession.currentProfile()?.gatewayId;
      if (!gatewayId) throw new Error('NOT_PAIRED');
      let version = await this.localStore.consent(gatewayId);
      if (version === undefined) {
        const settings = await this.repository.settings();
        if (!settings.consentAcknowledgedAt) throw new Error('CONSENT_REQUIRED:' + settings.consentPolicyVersion);
        version = settings.consentPolicyVersion;
        await this.localStore.saveConsent(gatewayId, version);
      }
      const permission = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context,
        ['ohos.permission.MICROPHONE']);
      if (generation !== this.generation) return;
      if (permission.authResults[0] !== 0) throw new Error('MICROPHONE_PERMISSION_REQUIRED');
      const session: XopcLocalRecording = { id: util.generateRandomUUID(), gatewayId, consentVersion: version,
        recordedAt: Date.now(), discussionId: '', noteId: '', markers: [] };
      await this.localStore.create(session);
      this.localSession = session;
      const streamInfo: audio.AudioStreamInfo = { samplingRate: 16000, channels: audio.AudioChannel.CHANNEL_1,
        sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE, encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW };
      this.capturer = await audio.createAudioCapturer({ streamInfo,
        capturerInfo: { source: audio.SourceType.SOURCE_TYPE_MIC, capturerFlags: 0 } });
      this.capturer.on('audioInterrupt', (_event: audio.InterruptEvent): void => {
        if (generation === this.generation && this.capturing) void this.fail('CAPTURE_INTERRUPTED');
      });
      await this.capturer.start();
      if (generation !== this.generation) return;
      this.capturing = true; this.phase = 'recording'; this.startTimers(generation);
      this.captureTask = this.captureLoop(generation);
      void this.startBackground(context, generation);
      this.startRealtime(generation);
      this.scheduleUpload();
    } catch (caught) {
      if (generation === this.generation) { this.error = (caught as Error).message; this.phase = 'error'; }
      await this.releaseAudio();
      throw caught as Error;
    }
  }

  togglePause(): void {
    if (this.phase === 'recording') { this.phase = 'paused'; this.level = 0; }
    else if (this.phase === 'paused') this.phase = 'recording';
  }

  mark(): void {
    if (this.phase !== 'recording' && this.phase !== 'paused') return;
    this.markers = this.markers.concat([xopcPcmDurationMs(this.capturedBytes)]);
    const session = this.localSession;
    if (session) void this.localStore.saveMarkers(session.id, this.markers).catch((): void => { void this.fail('CAPTURE_STORAGE_FAILED'); });
  }

  stop(): Promise<string> {
    if (this.stopTask) return this.stopTask;
    this.stopTask = this.finish().finally((): void => { this.stopTask = undefined; });
    return this.stopTask;
  }

  private async finish(): Promise<string> {
    const session = this.localSession;
    if (!session || (this.phase !== 'recording' && this.phase !== 'paused' && this.phase !== 'error')) return this.noteId;
    const recoveringPrefix = this.phase === 'error';
    this.phase = 'stopping';
    try {
      await this.finishLocal();
      if (this.storageFailed) {
        // The durable prefix remains recoverable even if the final write failed.
        this.recovered = true;
        this.storageFailed = false;
        if (!recoveringPrefix) throw new Error('CAPTURE_STORAGE_FAILED');
      }
      await this.uploadTask;
      await this.uploadOriginals();
      this.assertGateway(session);
      const detail = await this.repository.byNote(this.noteId);
      if (!detail.discussion.audioAttachmentId) {
        const manifest: XopcDiscussionRecordingManifest = { lastSequence: -1, chunkCount: this.sequence,
          mimeType: 'audio/wav', fileName: 'voice-note-' + session.recordedAt + '.wav', containerMode: 'independent_wav' };
        await this.repository.seal(this.discussionId, manifest);
      } else {
        await this.localStore.remove(session.id);
        this.localSession = undefined;
      }
      // A queued seal is not confirmation of the assembled original. Retain local audio until checked on return/restart.
      this.phase = 'completed'; this.error = ''; this.recovered = false;
    } catch (caught) {
      this.error = (caught as Error).message; this.phase = 'error';
    } finally { void this.releaseRealtime('user_finished'); }
    return this.noteId;
  }

  private finishLocal(): Promise<void> {
    if (this.localFinishTask) return this.localFinishTask;
    this.capturing = false; this.level = 0; this.clearTimers();
    this.localFinishTask = this.closeLocal();
    return this.localFinishTask;
  }

  private async closeLocal(): Promise<void> {
    try {
      await this.releaseAudio();
      await xopcCaptureShutdown(this.captureTask);
      await this.flushChunk();
    } catch (_error) {
      this.storageFailed = true;
    } finally {
      this.elapsedMs = this.savedDurationMs;
    }
  }

  async discard(): Promise<void> {
    await this.finishLocal().catch((): void => {});
    ++this.generation;
    // In-flight network work must finish before its session can be removed or replaced.
    await this.uploadTask;
    const session = this.localSession;
    if (session?.discussionId) {
      try { this.assertGateway(session); await this.repository.cancel(session.discussionId); }
      catch (caught) { this.error = (caught as Error).message; this.phase = 'error'; return; }
    }
    if (session) await this.localStore.remove(session.id);
    void this.releaseRealtime('surface_closed');
    this.localSession = undefined; this.pcmParts = []; this.pcmBytes = 0; this.discussionId = ''; this.noteId = ''; this.context = undefined;
    this.phase = 'idle'; this.error = ''; this.transcript = ''; this.realtimeTranscript = ''; this.realtimeActive = false;
    this.elapsedMs = 0; this.savedDurationMs = 0; this.level = 0; this.markers = []; this.recovered = false;
    this.localFinishTask = undefined;
  }

  reset(): void {
    if (this.active) return;
    this.phase = 'idle'; this.error = ''; this.transcript = ''; this.realtimeTranscript = ''; this.realtimeActive = false;
    this.localSession = undefined; this.localFinishTask = undefined;
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
        const copy = bytes.slice(0, Math.min(bytes.byteLength, XOPC_CAPTURE_MAX_MS * 32 - this.capturedBytes));
        this.pcmParts.push(copy); this.pcmBytes += copy.byteLength; this.capturedBytes += copy.byteLength;
        try { this.live?.audio(copy); } catch (_error) { void this.releaseRealtime('surface_closed'); }
        this.level = xopcAudioLevel(copy);
        if (this.pcmBytes >= XOPC_CAPTURE_SEGMENT_BYTES) await this.flushChunk();
        if (xopcPcmDurationMs(this.capturedBytes) >= XOPC_CAPTURE_MAX_MS) { void this.stop(); return; }
      }
    } catch (caught) {
      if (generation === this.generation && this.capturing) void this.fail((caught as Error).message || 'CAPTURE_FAILED');
    }
  }

  private flushChunk(): Promise<void> {
    if (this.writeTask) return this.writeTask;
    this.writeTask = this.persistChunk().finally((): void => { this.writeTask = undefined; });
    return this.writeTask;
  }

  private async persistChunk(): Promise<void> {
    const session = this.localSession;
    if (!this.pcmBytes || !session || this.storageFailed) return;
    const endedAtMs = xopcPcmDurationMs(this.capturedBytes);
    const startedAtMs = this.savedDurationMs;
    const wav = xopcPcm16Wav(this.pcmParts);
    try {
      await this.localStore.append(session.id, { sequence: this.sequence, startedAtMs, endedAtMs, uploaded: false }, wav);
      this.sequence++; this.savedDurationMs = endedAtMs;
      this.pcmParts = []; this.pcmBytes = 0;
      this.transcriptPending = true;
      this.scheduleUpload();
    } catch (caught) {
      this.storageFailed = true;
      this.pcmParts = []; this.pcmBytes = 0;
      throw caught as Error;
    }
  }

  private assertGateway(session: XopcLocalRecording): void {
    if (gatewaySession.currentProfile()?.gatewayId !== session.gatewayId) throw new Error('RECORDING_GATEWAY_CHANGED');
  }

  private scheduleUpload(): void {
    this.uploadRequested = true;
    if (this.uploadTask) return;
    this.uploadTask = this.drainOriginals().catch((caught: Error): void => {
      this.uploadRequested = false;
      hilog.warn(0x0000, 'XopcCapture', 'Original audio sync delayed: %{public}s', caught.message);
      if (this.phase === 'recording' || this.phase === 'paused') this.error = 'CAPTURE_UPLOAD_PENDING';
    }).finally((): void => {
      this.uploadTask = undefined;
      if (this.uploadRequested && this.capturing) this.scheduleUpload();
    });
  }

  private async drainOriginals(): Promise<void> {
    do {
      this.uploadRequested = false;
      await this.uploadOriginals();
    } while (this.uploadRequested && this.capturing);
  }

  private async uploadOriginals(): Promise<void> {
    const session = this.localSession;
    if (!session) return;
    this.assertGateway(session);
    if (!session.discussionId) {
      const detail = await this.repository.create(session.id, session.consentVersion, session.recordedAt);
      this.assertGateway(session);
      await this.localStore.attachServer(session.id, detail.discussion.id, detail.discussion.noteId);
      session.discussionId = detail.discussion.id; session.noteId = detail.discussion.noteId;
      this.discussionId = session.discussionId; this.noteId = session.noteId;
    }
    // Recover a lost seal response before attempting to upload chunks removed by the server.
    let remoteSequences: number[] | undefined = undefined;
    if (!this.capturing) {
      const detail = await this.repository.byNote(session.noteId);
      if (detail.discussion.audioAttachmentId || detail.recordingJob?.state === 'queued' || detail.recordingJob?.state === 'running') return;
      remoteSequences = await this.repository.recordingSequences(session.discussionId);
      this.assertGateway(session);
    }
    const chunks = await this.localStore.chunks(session.id);
    for (const chunk of chunks) {
      if (remoteSequences ? remoteSequences.includes(chunk.sequence) : chunk.uploaded) continue;
      this.assertGateway(session);
      const wav = await this.localStore.audio(session.id, chunk.sequence);
      await this.repository.uploadOriginal(session.discussionId, chunk.sequence, wav);
      this.assertGateway(session);
      await this.localStore.acknowledge(session.id, chunk.sequence);
      // Live text is best effort, bounded to one in-flight segment. Original audio repairs skipped text.
      if (!this.liveUploadTask && this.capturing) {
        this.liveUploadTask = this.repository.uploadTranscript(session.discussionId, chunk.sequence, wav,
          chunk.startedAtMs, chunk.endedAtMs).then((transcript: XopcDiscussionTranscript): void => {
            if (this.localSession?.id === session.id) this.applyTranscript(transcript);
          }).catch((): void => {}).finally((): void => { this.liveUploadTask = undefined; });
      }
    }
    this.transcriptPending = false;
    if (this.error === 'CAPTURE_UPLOAD_PENDING') this.error = '';
  }

  private applyTranscript(value: XopcDiscussionTranscript): void {
    this.transcript = value.text.trim();
    if (this.transcript && this.phase !== 'error' && this.error === 'LIVE_TRANSCRIPTION_DELAYED') this.error = '';
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

  }

  private clearTimers(): void {
    if (this.clockTimer !== -1) clearInterval(this.clockTimer);
    if (this.pollTimer !== -1) clearInterval(this.pollTimer);
    this.clockTimer = -1; this.pollTimer = -1;
  }

  private async startBackground(context: common.UIAbilityContext, generation: number): Promise<void> {
    try {
      const session = await avSession.createAVSession(context, 'xopc-voice-note', 'audio');
      if (generation !== this.generation || !this.capturing) { await session.destroy(); return; }
      this.session = session;
      session.on('stop', (): void => { if (generation === this.generation) void this.stop(); });
      await session.setAVMetadata({ assetId: 'xopc-voice-note', title: 'xopc', artist: 'Voice note' });
      await session.setAVPlaybackState({ state: avSession.PlaybackState.PLAYBACK_STATE_PLAY, speed: 1,
        position: { elapsedTime: 0, updateTime: Date.now() } });
      await session.activate();
      const agent = await wantAgent.getWantAgent({ wants: [{ bundleName: 'ai.xopc.xopc', abilityName: 'EntryAbility' }],
        actionType: wantAgent.OperationType.START_ABILITY, requestCode: 3,
        actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG] });
      await backgroundTaskManager.startBackgroundRunning(context, ['audioRecording'], agent);
      this.backgroundRunning = generation === this.generation && this.capturing;
      this.backgroundAvailable = this.backgroundRunning;
      if (!this.backgroundRunning) {
        await backgroundTaskManager.stopBackgroundRunning(context);
        await session.destroy();
      }
    } catch (_error) { this.backgroundAvailable = false; }
  }

  private async fail(reason: string): Promise<void> {
    this.error = reason;
    try { await this.finishLocal(); }
    catch (_error) { this.error = 'CAPTURE_STORAGE_FAILED'; }
    if (this.storageFailed) this.error = 'CAPTURE_STORAGE_FAILED';
    this.phase = 'error';
    void this.releaseRealtime('surface_closed');
  }

  private startRealtime(generation: number): void {
    const live = new XopcDiscussionLiveTranscription({
      onTranscript: (text: string): void => { if (generation === this.generation) this.realtimeTranscript = text; },
      onAvailability: (available: boolean): void => { if (generation === this.generation) this.realtimeActive = available; }
    });
    this.live = live;
    void live.start().catch((): void => { this.realtimeActive = false; });
  }

  private async releaseRealtime(reason: 'user_finished' | 'surface_closed'): Promise<void> {
    const live = this.live; this.live = undefined; this.realtimeActive = false;
    try { await live?.close(reason); } catch (_error) { /* Original audio is independent of live transport teardown. */ }
  }

  private async releaseAudio(): Promise<void> {
    this.clearTimers(); this.capturing = false;
    const capturer = this.capturer; const session = this.session; const context = this.context;
    const backgroundRunning = this.backgroundRunning;
    this.capturer = undefined; this.session = undefined; this.backgroundRunning = false;
    if (capturer) {
      try { capturer.off('audioInterrupt'); } catch (_error) {}
      try { await xopcCaptureShutdown(capturer.stop()); } catch (_error) {}
      try { await xopcCaptureShutdown(capturer.release()); } catch (_error) {}
    }
    if (session) {
      try { await xopcCaptureShutdown(session.setAVPlaybackState({ state: avSession.PlaybackState.PLAYBACK_STATE_STOP })); } catch (_error) {}
      try { await xopcCaptureShutdown(session.deactivate()); } catch (_error) {}
      try { await xopcCaptureShutdown(session.destroy()); } catch (_error) {}
    }
    if (context && backgroundRunning) {
      try { await xopcCaptureShutdown(backgroundTaskManager.stopBackgroundRunning(context)); } catch (_error) {}
    }
  }
}

export const discussionCapture: XopcDiscussionCapture = new XopcDiscussionCapture();

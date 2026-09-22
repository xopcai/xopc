import { abilityAccessCtrl, common } from '@kit.AbilityKit';
import { media } from '@kit.MediaKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
import { gatewaySession } from './gatewaySession';
import { XopcHttpError } from './transport';
import { XopcChatAttachment } from '../model/chat';

interface VoiceHeaders { Authorization: string; 'Content-Type': string; }
interface VoicePayload { text: string; }
interface VoiceResult { ok: boolean; payload?: VoicePayload; }

@ObservedV2
export class XopcVoiceCapture {
  @Trace state: string = 'idle';
  @Trace seconds: number = 0;
  @Trace busy: boolean = false;
  @Trace error: string = '';
  private recorder?: media.AVRecorder;
  private file?: fs.File;
  private path: string = '';
  private generation: number = 0;
  private timer: number = -1;
  private operation?: Promise<void>;
  private cancellation?: Promise<void>;
  private request?: http.HttpRequest;
  private player?: media.AVPlayer;
  private playbackFile?: fs.File;
  private startedAt: number = 0;
  private durationMs: number = 0;

  async start(context: common.UIAbilityContext): Promise<void> {
    if (this.busy || this.state !== 'idle') return;
    this.busy = true; this.error = ''; this.state = 'preparing';
    const generation = ++this.generation;
    this.operation = this.startCapture(context, generation);
    await this.operation;
  }

  private async startCapture(context: common.UIAbilityContext, generation: number): Promise<void> {
    try {
      const permission = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context, ['ohos.permission.MICROPHONE']);
      if (generation !== this.generation) return;
      if (permission.authResults[0] !== 0) throw new Error('MICROPHONE_PERMISSION_REQUIRED');
      this.path = context.cacheDir + '/xopc-voice-' + util.generateRandomUUID() + '.m4a';
      this.file = await fs.open(this.path, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE);
      if (generation !== this.generation) return;
      this.recorder = await media.createAVRecorder();
      if (generation !== this.generation) return;
      this.recorder.on('error', (_error: BusinessError): void => {
        if (generation === this.generation) {
          this.error = 'RECORDING_FAILED'; this.cancel();
        }
      });
      const config: media.AVRecorderConfig = {
        audioSourceType: media.AudioSourceType.AUDIO_SOURCE_TYPE_MIC,
        profile: { audioBitrate: 64000, audioChannels: 1, audioCodec: media.CodecMimeType.AUDIO_AAC,
          audioSampleRate: 48000, fileFormat: media.ContainerFormatType.CFT_MPEG_4A },
        url: 'fd://' + this.file.fd
      };
      await this.recorder.prepare(config);
      if (generation !== this.generation) return;
      await this.recorder.start();
      if (generation !== this.generation) return;
      this.state = 'recording'; this.seconds = 0;
      this.durationMs = 0; this.startedAt = Date.now();
      const startedAt = Date.now();
      this.timer = setInterval((): void => {
        this.seconds = Math.floor((Date.now() - startedAt) / 1000);
        if (this.seconds >= 120) this.stop();
      }, 250);
    } catch (error) {
      if (generation === this.generation) {
        this.error = (error as Error).message; await this.cleanup(); this.state = 'idle';
      }
    } finally { if (generation === this.generation) this.busy = false; }
  }

  async stop(): Promise<void> {
    if (this.busy || this.state !== 'recording') return;
    this.busy = true; this.clearTimer();
    this.durationMs = Date.now() - this.startedAt;
    this.operation = this.finishCapture(this.generation);
    await this.operation;
  }

  private async finishCapture(generation: number): Promise<void> {
    try {
      await this.recorder?.stop(); await this.recorder?.release(); this.recorder = undefined;
      if (this.file) await fs.close(this.file); this.file = undefined;
      if (generation === this.generation) this.state = 'ready';
    } catch (error) {
      if (generation === this.generation) {
        this.error = (error as Error).message; await this.cleanup(); this.state = 'idle';
      }
    } finally { if (generation === this.generation) this.busy = false; }
  }

  async transcribe(language: string): Promise<string | undefined> {
    if (this.busy || this.state !== 'ready') return undefined;
    this.busy = true; this.error = ''; this.state = 'transcribing';
    const generation = this.generation;
    let transcript: string | undefined = undefined;
    this.operation = this.uploadRecording(language, generation).then((text: string | undefined): void => { transcript = text; });
    await this.operation;
    return generation === this.generation ? transcript : undefined;
  }

  async send(sendAttachment: (attachment: XopcChatAttachment) => Promise<boolean>): Promise<boolean> {
    if (this.busy || this.state !== 'ready') return false;
    this.busy = true; this.error = '';
    const generation = this.generation;
    let sent: boolean = false;
    this.operation = this.sendRecording(generation, sendAttachment).then((result: boolean): void => { sent = result; });
    await this.operation;
    return generation === this.generation && sent;
  }

  private async sendRecording(generation: number, sendAttachment: (attachment: XopcChatAttachment) => Promise<boolean>): Promise<boolean> {
    try {
      if (this.durationMs < 380) throw new Error('RECORDING_TOO_SHORT');
      const file = await fs.open(this.path, fs.OpenMode.READ_ONLY);
      let data: ArrayBuffer;
      try {
        const size = (await fs.stat(file.fd)).size;
        if (size <= 0 || size > 4 * 1024 * 1024) throw new Error('INVALID_RECORDING_SIZE');
        data = new ArrayBuffer(size);
        if (await fs.read(file.fd, data) !== size) throw new Error('INCOMPLETE_RECORDING');
      } finally { await fs.close(file); }
      const encoded = await new util.Base64Helper().encodeToString(new Uint8Array(data));
      if (generation !== this.generation) return false;
      const sent = await sendAttachment({ type: 'voice', name: 'voice.m4a', mimeType: 'audio/mp4',
        size: data.byteLength, data: encoded });
      if (generation !== this.generation) return false;
      if (sent) { await this.cleanup(); this.state = 'idle'; this.seconds = 0; }
      return sent;
    } catch (error) {
      if (generation === this.generation) this.error = (error as Error).message;
      return false;
    } finally { if (generation === this.generation) this.busy = false; }
  }

  async play(): Promise<void> {
    if (this.busy || this.state !== 'ready') return;
    this.busy = true; this.error = '';
    this.operation = this.preparePlayback(this.generation);
    await this.operation;
  }
  private async preparePlayback(generation: number): Promise<void> {
    try {
      this.playbackFile = await fs.open(this.path, fs.OpenMode.READ_ONLY);
      if (generation !== this.generation) return;
      const player = await media.createAVPlayer(); this.player = player;
      if (generation !== this.generation) return;
      player.on('stateChange', (state: string): void => {
        if (generation !== this.generation || this.player !== player) return;
        if (state === 'initialized') player.prepare().catch((_error: Error): void => { this.playbackError(); });
        if (state === 'prepared') player.play().catch((_error: Error): void => { this.playbackError(); });
        if (state === 'playing') { this.clearTimer(); this.state = 'playing'; this.busy = false; }
        if (state === 'completed') this.stopPlayback();
      });
      player.on('error', (_error: BusinessError): void => {
        if (generation === this.generation && this.player === player) this.playbackError();
      });
      this.timer = setTimeout((): void => { this.playbackError(); }, 10000);
      player.fdSrc = { fd: this.playbackFile.fd };
    } catch (error) {
      if (generation === this.generation) { this.error = (error as Error).message; await this.stopPlayback(); }
    }
  }
  private playbackError(): void { this.error = 'PLAYBACK_FAILED'; this.stopPlayback(); }
  async stopPlayback(): Promise<void> {
    this.clearTimer(); const generation = this.generation;
    this.busy = true; await this.releasePlayer();
    if (generation === this.generation) { this.state = 'ready'; this.busy = false; }
  }
  private async releasePlayer(): Promise<void> {
    const player = this.player; const file = this.playbackFile;
    this.player = undefined; this.playbackFile = undefined;
    try { await player?.release(); } catch (_error) {}
    if (file) { try { await fs.close(file); } catch (_error) {} }
  }

  private async uploadRecording(language: string, generation: number): Promise<string | undefined> {
    try {
      const file = await fs.open(this.path, fs.OpenMode.READ_ONLY);
      let data: ArrayBuffer;
      try {
        const size = (await fs.stat(file.fd)).size;
        if (size <= 0 || size > 4 * 1024 * 1024) throw new Error('INVALID_RECORDING_SIZE');
        data = new ArrayBuffer(size);
        if (await fs.read(file.fd, data) !== size) throw new Error('INCOMPLETE_RECORDING');
      } finally { await fs.close(file); }
      const auth = await gatewaySession.transferAuth();
      if (generation !== this.generation) return undefined;
      const headers: VoiceHeaders = { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'multipart/form-data' };
      const parts: http.MultiFormData[] = [{ name: 'audio', contentType: 'audio/m4a', remoteFileName: 'voice.m4a', data }];
      if (language === 'zh' || language === 'en') parts.push({ name: 'language', contentType: 'text/plain', data: language });
      this.request = http.createHttp();
      const result = await this.request.request(auth.origin + '/api/voice/transcriptions', {
        method: http.RequestMethod.POST, header: headers, multiFormDataList: parts,
        expectDataType: http.HttpDataType.STRING, maxLimit: 1024 * 1024,
        maxRedirects: 0, connectTimeout: 8000, readTimeout: 60000, usingCache: false
      });
      if (generation !== this.generation) return undefined;
      if (result.responseCode !== 200) throw new XopcHttpError(result.responseCode);
      const response = JSON.parse(result.result as string) as VoiceResult;
      if (!response.ok || typeof response.payload?.text !== 'string') throw new Error('INVALID_TRANSCRIPTION');
      const text = response.payload.text.trim();
      if (!text) throw new Error('EMPTY_TRANSCRIPTION');
      await this.cleanup(); this.state = 'idle'; return text;
    } catch (error) {
      if (generation === this.generation) { this.error = (error as Error).message; this.state = 'ready'; }
      return undefined;
    } finally {
      this.request?.destroy(); this.request = undefined;
      if (generation === this.generation) this.busy = false;
    }
  }

  async cancel(): Promise<void> {
    if (this.cancellation) return this.cancellation;
    ++this.generation; this.busy = true; this.clearTimer();
    this.request?.destroy();
    this.cancellation = this.cancelPending();
    await this.cancellation; this.cancellation = undefined;
  }
  private async cancelPending(): Promise<void> {
    try { await this.operation; } catch (_error) { /* Cleanup still runs after a failed operation. */ }
    await this.cleanup(); this.state = 'idle'; this.seconds = 0; this.busy = false;
  }
  private clearTimer(): void { if (this.timer !== -1) clearInterval(this.timer); this.timer = -1; }
  private async cleanup(): Promise<void> {
    this.clearTimer();
    await this.releasePlayer();
    try { await this.recorder?.release(); } catch (_error) { /* Release is best effort after native failure. */ }
    this.recorder = undefined;
    if (this.file) { try { await fs.close(this.file); } catch (_error) {} this.file = undefined; }
    if (this.path) { try { await fs.unlink(this.path); } catch (_error) {} this.path = ''; }
  }
}

export const voiceCapture: XopcVoiceCapture = new XopcVoiceCapture();

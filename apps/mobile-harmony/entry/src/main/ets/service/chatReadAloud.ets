import { common } from '@kit.AbilityKit';
import { media } from '@kit.MediaKit';
import { http } from '@kit.NetworkKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { gatewaySession } from './gatewaySession';
import { chatSpeechChunks, chatSpeechLanguage } from '../common/speechText';

interface XopcSpeechBody { text: string; language: string; }
interface XopcSpeechHeaders { Authorization: string; 'Content-Type': string; }

@ObservedV2
export class XopcChatReadAloud {
  @Trace state: string = 'idle';
  @Trace sourceId: string = '';
  @Trace error: string = '';
  @Trace position: number = 0;
  @Trace duration: number = 0;
  @Trace continuousConversationId: string = '';
  private generation: number = 0;
  private request?: http.HttpRequest;
  private player?: media.AVPlayer;
  private file?: fs.File;
  private path: string = '';
  private chunks: string[] = [];
  private chunkIndex: number = 0;
  private language: string = 'en-US';
  private context?: common.Context;

  async speak(context: common.Context, text: string, id: string, language: string): Promise<void> {
    const cleanup = this.stop();
    const generation = this.generation;
    await cleanup;
    if (generation !== this.generation) return;
    this.context = context; this.chunks = chatSpeechChunks(text); this.chunkIndex = 0; this.sourceId = id;
    this.language = chatSpeechLanguage(text, language); this.error = '';
    if (this.chunks.length) await this.next(generation);
  }
  private async next(generation: number): Promise<void> {
    if (generation !== this.generation || !this.context || this.chunkIndex >= this.chunks.length) { if (generation === this.generation) this.stop(); return; }
    this.state = 'loading'; this.position = 0; this.duration = 0;
    try {
      const auth = await gatewaySession.transferAuth(); if (generation !== this.generation) return;
      const request = http.createHttp(); this.request = request;
      const body: XopcSpeechBody = { text: this.chunks[this.chunkIndex], language: this.language };
      const headers: XopcSpeechHeaders = { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json' };
      let bytes: ArrayBuffer;
      try {
        const response = await request.request(auth.origin + '/api/voice/speech', { method: http.RequestMethod.POST, header: headers,
          extraData: JSON.stringify(body), expectDataType: http.HttpDataType.ARRAY_BUFFER, maxRedirects: 0,
          maxLimit: 16 * 1024 * 1024, connectTimeout: 8000, readTimeout: 60000, usingCache: false });
        if (response.responseCode !== 200) throw new Error('SPEECH_HTTP_' + response.responseCode);
        bytes = response.result as ArrayBuffer;
        if (!bytes.byteLength) throw new Error('EMPTY_SPEECH');
      } finally { request.destroy(); if (this.request === request) this.request = undefined; }
      if (generation !== this.generation) return;
      const path = this.context.cacheDir + '/xopc-speech-' + util.generateRandomUUID() + '.audio';
      const file = await fs.open(path, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE);
      if (generation !== this.generation) { await fs.close(file); await fs.unlink(path); return; }
      this.file = file; this.path = path;
      if (await fs.write(file.fd, bytes) !== bytes.byteLength) throw new Error('INCOMPLETE_SPEECH');
      if (generation !== this.generation) return;
      const player = await media.createAVPlayer();
      if (generation !== this.generation) { await player.release(); return; }
      this.player = player;
      player.on('stateChange', (state: string): void => {
        if (generation !== this.generation || this.player !== player) return;
        if (state === 'initialized') player.prepare().catch((error: Error): void => { this.fail(error, generation); });
        else if (state === 'prepared') { this.duration = player.duration; player.play().catch((error: Error): void => { this.fail(error, generation); }); }
        else if (state === 'playing' || state === 'paused') this.state = state;
        else if (state === 'completed') this.advance(generation);
      });
      player.on('timeUpdate', (time: number): void => { if (generation === this.generation) this.position = time; });
      player.on('error', (error: Error): void => { this.fail(error, generation); });
      player.fdSrc = { fd: file.fd, offset: 0, length: bytes.byteLength };
    } catch (error) { this.fail(error as Error, generation); }
  }
  private async advance(generation: number): Promise<void> {
    await this.releaseOutput(); if (generation !== this.generation) return;
    this.chunkIndex++; await this.next(generation);
  }
  private fail(error: Error, generation: number): void {
    if (generation !== this.generation) return;
    this.error = error.message; this.stop();
  }
  async toggle(): Promise<void> {
    const generation = this.generation;
    try { if (this.state === 'playing') await this.player?.pause(); else if (this.state === 'paused') await this.player?.play(); }
    catch (error) { this.fail(error as Error, generation); }
  }
  seek(value: number): void { try { this.player?.seek(Math.max(0, Math.min(value, this.duration))); } catch (error) { this.error = (error as Error).message; } }
  private async releaseOutput(): Promise<void> {
    const player = this.player; const file = this.file; const path = this.path;
    this.player = undefined; this.file = undefined; this.path = '';
    try { await player?.release(); } catch (_) {}
    if (file) { try { await fs.close(file); } catch (_) {} }
    if (path) { try { await fs.unlink(path); } catch (_) {} }
  }
  async stop(): Promise<void> {
    this.generation++; this.request?.destroy(); this.request = undefined;
    this.state = 'idle'; this.sourceId = ''; await this.releaseOutput();
  }
  disableContinuous(): void { this.continuousConversationId = ''; this.stop(); }
}
export const chatReadAloud: XopcChatReadAloud = new XopcChatReadAloud();

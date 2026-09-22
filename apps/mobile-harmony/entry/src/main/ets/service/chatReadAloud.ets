import { common, wantAgent } from '@kit.AbilityKit';
import { avSession } from '@kit.AVSessionKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
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
  private session?: avSession.AVSession;
  private backgroundRunning: boolean = false;

  async speak(context: common.Context, text: string, id: string, language: string): Promise<void> {
    const cleanup = this.stop();
    const generation = this.generation;
    await cleanup;
    if (generation !== this.generation) return;
    this.context = context; this.chunks = chatSpeechChunks(text); this.chunkIndex = 0; this.sourceId = id;
    this.language = chatSpeechLanguage(text, language); this.error = '';
    await this.startPlaybackSession(context, id, generation);
    if (generation !== this.generation) return;
    if (this.chunks.length) await this.next(generation);
  }
  private async startPlaybackSession(context: common.Context, id: string, generation: number): Promise<void> {
    try {
      const session = await avSession.createAVSession(context, 'xopc-chat-read-aloud', 'audio');
      if (generation !== this.generation) { await session.destroy(); return; }
      this.session = session;
      session.on('play', (): void => { this.player?.play().catch((_error: Error): void => {}); });
      session.on('pause', (): void => { this.player?.pause().catch((_error: Error): void => {}); });
      session.on('stop', (): void => { this.stop().catch((_error: Error): void => {}); });
      await session.setAVMetadata({ assetId: id, title: 'xopc', artist: 'Chat read aloud' });
      await session.activate();
      if (generation !== this.generation) return;
      const agent = await wantAgent.getWantAgent({
        wants: [{ bundleName: 'ai.xopc.mobile', abilityName: 'EntryAbility' }],
        actionType: wantAgent.OperationType.START_ABILITY,
        requestCode: 0,
        actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
      });
      await backgroundTaskManager.startBackgroundRunning(context, backgroundTaskManager.BackgroundMode.AUDIO_PLAYBACK, agent);
      if (generation === this.generation) this.backgroundRunning = true;
      else await backgroundTaskManager.stopBackgroundRunning(context);
    } catch (_) {
      // Playback remains usable in the foreground when a system media service is unavailable.
    }
  }
  private updatePlaybackSession(state: avSession.PlaybackState): void {
    this.session?.setAVPlaybackState({ state, speed: 1, position: { elapsedTime: this.position, updateTime: Date.now() } })
      .catch((_error: Error): void => {});
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
        else if (state === 'playing') { this.state = state; this.updatePlaybackSession(avSession.PlaybackState.PLAYBACK_STATE_PLAY); }
        else if (state === 'paused') { this.state = state; this.updatePlaybackSession(avSession.PlaybackState.PLAYBACK_STATE_PAUSE); }
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
    this.state = 'idle'; this.sourceId = ''; await this.releaseOutput(); await this.releasePlaybackSession();
  }
  private async releasePlaybackSession(): Promise<void> {
    const context = this.context; const session = this.session; const backgroundRunning = this.backgroundRunning;
    this.session = undefined; this.backgroundRunning = false; this.context = undefined;
    if (session) {
      try { await session.setAVPlaybackState({ state: avSession.PlaybackState.PLAYBACK_STATE_STOP }); } catch (_) {}
      try { await session.deactivate(); } catch (_) {}
      try { await session.destroy(); } catch (_) {}
    }
    if (context && backgroundRunning) { try { await backgroundTaskManager.stopBackgroundRunning(context); } catch (_) {} }
  }
  leaveForeground(): void { this.continuousConversationId = ''; }
  disableContinuous(): void { this.continuousConversationId = ''; this.stop(); }
}
export const chatReadAloud: XopcChatReadAloud = new XopcChatReadAloud();

import { common, wantAgent } from '@kit.AbilityKit';
import { avSession } from '@kit.AVSessionKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { media } from '@kit.MediaKit';
import { http } from '@kit.NetworkKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { gatewaySession } from './gatewaySession';
import { signedHttpRequest } from './requestProof';
import { chatSpeechChunks, chatSpeechLanguage } from '../common/speechText';
import { XopcChatSpeechReply } from '../common/chatAutoRead';
import { XopcTransientNotice } from '../common/transientNotice';
import { XopcChatRow } from '../model/chat';

interface XopcSpeechBody { text: string; language: string; }
interface XopcSpeechHeaders { Authorization: string; 'Content-Type': string; }
interface XopcSpeechPosition { chunk: number; offset: number; autoplay: boolean; }
interface XopcSpeechQueue {
  conversation: string;
  pending: XopcChatSpeechReply[];
  seen: Set<string>;
  firstRowId: string;
  position?: XopcSpeechPosition;
}

@ObservedV2
export class XopcChatReadAloud {
  @Trace state: string = 'idle';
  @Trace sourceId: string = '';
  @Trace error: string = '';
  private errorNotice: XopcTransientNotice = new XopcTransientNotice((message: string): void => { this.error = message; });
  private noticesEnabled: boolean = true;

  dismissError(): void { this.errorNotice.clear(); }
  @Trace position: number = 0;
  @Trace duration: number = 0;
  @Trace owner: number = 0;
  @Trace continuousEnabled: boolean = false;
  private generation: number = 0;
  private request?: http.HttpRequest;
  private prefetchRequest?: http.HttpRequest;
  private prefetchPromise?: Promise<ArrayBuffer>;
  private prefetchIndex: number = -1;
  private player?: media.AVPlayer;
  private file?: fs.File;
  private path: string = '';
  private chunks: string[] = [];
  private chunkIndex: number = 0;
  private language: string = 'en-US';
  private context?: common.Context;
  private session?: avSession.AVSession;
  private backgroundRunning: boolean = false;
  private cleanup: Promise<void> = Promise.resolve();
  private scope: string = '';
  private gateway: string = '';
  private conversationId: string = '';
  private queues: Map<string, XopcSpeechQueue> = new Map<string, XopcSpeechQueue>();
  private replies: XopcChatSpeechReply[] = [];
  private firstRowId: string = '';
  private chatContext?: common.Context;
  private chatLanguage: string = 'en-US';
  private chatPlaybackAllowed: boolean = false;
  private playbackPosition: XopcSpeechPosition = { chunk: 0, offset: 0, autoplay: true };

  showConversation(owner: number, context: common.Context, gateway: string, conversation: string, transcript: string,
    replies: XopcChatSpeechReply[], language: string, playbackAllowed: boolean = true, rows: XopcChatRow[] = []): void {
    const scope = JSON.stringify([gateway, conversation, transcript]);
    if (this.scope !== scope) {
      if (this.owner) this.leaveForeground(this.owner);
      if (this.gateway !== gateway) this.queues.clear();
      if (transcript) {
        const draft = this.queues.get(JSON.stringify([gateway, conversation, '']));
        if (draft) this.queues.set(scope, draft);
        this.queues.forEach((queue: XopcSpeechQueue, key: string): void => {
          if (queue.conversation === conversation && key !== scope) this.queues.delete(key);
        });
      }
      this.gateway = gateway; this.scope = scope; this.conversationId = conversation;
    }
    this.owner = owner; this.chatContext = context; this.chatLanguage = language; this.replies = replies;
    this.firstRowId = rows[0]?.id ?? '';
    this.chatPlaybackAllowed = playbackAllowed;
    const queue = this.queues.get(scope);
    this.continuousEnabled = queue !== undefined;
    if (!queue) return;
    // A page fetched above the previously loaded messages is history, even when that page contains the first speakable reply.
    if (queue.firstRowId && this.firstRowId !== queue.firstRowId) {
      const firstKnown = rows.findIndex((row: XopcChatRow): boolean => row.id === queue.firstRowId
        || row.sourceIds?.includes(queue.firstRowId) === true);
      for (let index = 0; index < firstKnown; index++) queue.seen.add(rows[index].id);
    }
    queue.firstRowId = this.firstRowId;
    let anchor = replies.length - 1;
    while (anchor >= 0 && !queue.seen.has(replies[anchor].id)) anchor--;
    for (let index = anchor + 1; index < replies.length; index++) {
      const reply = replies[index];
      if (queue.seen.has(reply.id)) continue;
      queue.seen.add(reply.id); queue.pending.push(reply);
    }
    if (queue.pending.length && this.state === 'idle' && playbackAllowed) void this.playNext();
  }

  async toggleContinuous(owner: number): Promise<void> {
    if (owner !== this.owner || !this.scope) return;
    if (this.continuousEnabled) {
      this.queues.delete(this.scope);
      this.continuousEnabled = false;
      await this.stopOutput();
    } else {
      const seen = new Set<string>(this.replies.map<string>((reply: XopcChatSpeechReply): string => reply.id));
      this.queues.set(this.scope, { conversation: this.conversationId, pending: [], seen, firstRowId: this.firstRowId });
      this.continuousEnabled = true;
    }
  }

  async readFrom(owner: number, reply: XopcChatSpeechReply): Promise<void> {
    if (owner !== this.owner || !this.chatContext || !this.chatPlaybackAllowed) return;
    const queue = this.queues.get(this.scope);
    if (!queue) {
      await this.speak(this.chatContext, reply.text, reply.id, this.chatLanguage);
      return;
    }
    queue.seen.add(reply.id);
    queue.pending = [reply].concat(queue.pending.filter((item: XopcChatSpeechReply): boolean => item.id !== reply.id));
    queue.position = undefined;
    await this.playNext();
  }

  private async playNext(): Promise<void> {
    const queue = this.queues.get(this.scope);
    if (!queue || !this.chatContext || !this.chatPlaybackAllowed) { await this.stopOutput(); return; }
    while (queue.pending.length) {
      const reply = queue.pending[0];
      const chunks = chatSpeechChunks(reply.text);
      if (chunks.length) {
        await this.startSpeech(this.chatContext, reply.text, reply.id, this.chatLanguage, chunks, queue.position);
        return;
      }
      queue.pending.shift();
      queue.position = undefined;
    }
    await this.stopOutput();
  }

  async speak(context: common.Context, text: string, id: string, language: string): Promise<void> {
    await this.startSpeech(context, text, id, language, chatSpeechChunks(text));
  }

  private async startSpeech(context: common.Context, text: string, id: string, language: string, chunks: string[],
    saved?: XopcSpeechPosition): Promise<void> {
    this.noticesEnabled = true;
    const cleanup = this.stopOutput();
    const generation = this.generation;
    this.chunks = chunks;
    if (!this.chunks.length) return;
    this.playbackPosition = saved ?? { chunk: 0, offset: 0, autoplay: true };
    this.chunkIndex = Math.min(this.playbackPosition.chunk, this.chunks.length - 1);
    this.sourceId = id; this.state = 'loading';
    await cleanup;
    if (generation !== this.generation) return;
    this.context = context;
    this.language = chatSpeechLanguage(text, language);
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
        wants: [{ bundleName: 'ai.xopc.xopc', abilityName: 'EntryAbility' }],
        actionType: wantAgent.OperationType.START_ABILITY,
        requestCode: 0,
        actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
      });
      if (generation !== this.generation) return;
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
  private async requestChunk(index: number, generation: number, prefetch: boolean): Promise<ArrayBuffer> {
    const auth = await gatewaySession.transferAuth();
    if (generation !== this.generation) throw new Error('STALE_SPEECH');
    const request = http.createHttp();
    if (prefetch) this.prefetchRequest = request;
    else this.request = request;
    const body: XopcSpeechBody = { text: this.chunks[index], language: this.language };
    const headers: XopcSpeechHeaders = { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json' };
    try {
      const response = await signedHttpRequest(request, auth.origin + '/api/voice/speech', { method: http.RequestMethod.POST, header: headers,
        extraData: JSON.stringify(body), expectDataType: http.HttpDataType.ARRAY_BUFFER, maxRedirects: 0,
        maxLimit: 16 * 1024 * 1024, connectTimeout: 8000, readTimeout: 60000, usingCache: false });
      if (response.responseCode !== 200) throw new Error('SPEECH_HTTP_' + response.responseCode);
      const bytes = response.result as ArrayBuffer;
      if (!bytes.byteLength) throw new Error('EMPTY_SPEECH');
      if (generation !== this.generation) throw new Error('STALE_SPEECH');
      return bytes;
    } finally {
      request.destroy();
      if (this.request === request) this.request = undefined;
      if (this.prefetchRequest === request) this.prefetchRequest = undefined;
    }
  }
  private prefetchNext(generation: number): void {
    const index = this.chunkIndex + 1;
    if (generation !== this.generation || index >= this.chunks.length || this.prefetchIndex === index) return;
    this.prefetchIndex = index;
    const pending = this.requestChunk(index, generation, true);
    this.prefetchPromise = pending;
    void pending.catch((_error: Error): void => {});
  }
  private async bytesForChunk(index: number, generation: number): Promise<ArrayBuffer> {
    if (this.prefetchIndex === index && this.prefetchPromise) {
      try {
        const bytes = await this.prefetchPromise;
        if (generation !== this.generation) throw new Error('STALE_SPEECH');
        return bytes;
      } catch (_error) {
        if (generation !== this.generation) throw new Error('STALE_SPEECH');
      } finally {
        if (generation === this.generation) {
          this.prefetchIndex = -1;
          this.prefetchPromise = undefined;
        }
      }
    }
    return this.requestChunk(index, generation, false);
  }
  private async next(generation: number): Promise<void> {
    if (generation !== this.generation || !this.context) return;
    if (this.chunkIndex >= this.chunks.length) {
      const queue = this.queues.get(this.scope);
      if (queue?.pending[0]?.id === this.sourceId) {
        queue.pending.shift(); queue.position = undefined;
      }
      await this.playNext();
      return;
    }
    this.state = 'loading'; this.position = this.playbackPosition.offset; this.duration = 0;
    try {
      const prefetched = this.prefetchIndex === this.chunkIndex;
      const pending = this.bytesForChunk(this.chunkIndex, generation);
      if (!prefetched) this.prefetchNext(generation);
      const bytes = await pending;
      if (generation !== this.generation) return;
      this.prefetchNext(generation);
      const path = this.context.cacheDir + '/xopc-speech-' + util.generateRandomUUID() + '.audio';
      const file = await fs.open(path, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE);
      if (generation !== this.generation) { await fs.close(file); await fs.unlink(path); return; }
      this.file = file; this.path = path;
      if (await fs.write(file.fd, bytes) !== bytes.byteLength) throw new Error('INCOMPLETE_SPEECH');
      if (generation !== this.generation) return;
      const player = await media.createAVPlayer();
      if (generation !== this.generation) { await player.release(); return; }
      this.player = player;
      let restoring = this.playbackPosition.offset > 0;
      const playOrPause = (): void => {
        if (this.playbackPosition.autoplay) player.play().catch((error: Error): void => { this.fail(error, generation); });
        else { this.state = 'paused'; this.updatePlaybackSession(avSession.PlaybackState.PLAYBACK_STATE_PAUSE); }
      };
      player.on('seekDone', (time: number): void => {
        if (generation !== this.generation || this.player !== player || !restoring) return;
        restoring = false; this.position = time; playOrPause();
      });
      player.on('stateChange', (state: string): void => {
        if (generation !== this.generation || this.player !== player) return;
        if (state === 'initialized') player.prepare().catch((error: Error): void => { this.fail(error, generation); });
        else if (state === 'prepared') {
          this.duration = player.duration;
          if (restoring) {
            try { player.seek(Math.min(this.playbackPosition.offset, Math.max(0, this.duration - 1))); }
            catch (_) { restoring = false; playOrPause(); }
          } else playOrPause();
        }
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
    this.state = 'loading'; this.position = 0; this.chunkIndex++;
    this.playbackPosition = { chunk: this.chunkIndex, offset: 0, autoplay: true };
    await this.releaseOutput(); if (generation !== this.generation) return;
    await this.next(generation);
  }
  private fail(error: Error, generation: number): void {
    if (generation !== this.generation) return;
    this.stop(true);
    if (this.noticesEnabled) this.errorNotice.show(error.message);
  }
  async toggle(): Promise<void> {
    const generation = this.generation;
    try { if (this.state === 'playing') await this.player?.pause(); else if (this.state === 'paused') await this.player?.play(); }
    catch (error) { this.fail(error as Error, generation); }
  }
  seek(value: number): void { try { this.player?.seek(Math.max(0, Math.min(value, this.duration))); } catch (error) { if (this.noticesEnabled) this.errorNotice.show((error as Error).message); } }
  private async releaseOutput(): Promise<void> {
    const player = this.player; const file = this.file; const path = this.path;
    this.player = undefined; this.file = undefined; this.path = '';
    try { await player?.release(); } catch (_) {}
    if (file) { try { await fs.close(file); } catch (_) {} }
    if (path) { try { await fs.unlink(path); } catch (_) {} }
  }
  async stop(preserveError: boolean = false): Promise<void> {
    const queue = this.queues.get(this.scope);
    if (queue) { queue.pending = []; queue.position = undefined; }
    await this.stopOutput(preserveError);
  }
  private async stopOutput(preserveError: boolean = false): Promise<void> {
    if (!preserveError) this.dismissError();
    this.generation++; this.request?.destroy(); this.request = undefined;
    this.prefetchRequest?.destroy(); this.prefetchRequest = undefined;
    this.prefetchPromise = undefined; this.prefetchIndex = -1;
    this.state = 'idle'; this.sourceId = '';
    const previous = this.cleanup;
    const output = this.releaseOutput();
    const session = this.releasePlaybackSession();
    this.cleanup = Promise.all([previous, output, session]).then((): void => {});
    await this.cleanup;
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
  leaveForeground(owner?: number): void {
    if (owner !== undefined && owner !== this.owner) return;
    this.noticesEnabled = false; this.dismissError();
    if (owner === undefined) return;
    const queue = this.queues.get(this.scope);
    if (queue && queue.pending[0]?.id === this.sourceId) {
      if (this.chunkIndex >= this.chunks.length) {
        queue.pending.shift(); queue.position = undefined;
      } else {
        const time = this.player?.currentTime;
        queue.position = { chunk: this.chunkIndex, offset: time !== undefined && time >= 0 ? time : this.position,
          autoplay: this.state === 'playing' || (this.state === 'loading' && this.playbackPosition.autoplay) };
      }
    }
    this.owner = 0; this.scope = ''; this.chatContext = undefined; this.replies = [];
    this.firstRowId = '';
    this.continuousEnabled = false;
    void this.stopOutput();
  }
}
export const chatReadAloud: XopcChatReadAloud = new XopcChatReadAloud();

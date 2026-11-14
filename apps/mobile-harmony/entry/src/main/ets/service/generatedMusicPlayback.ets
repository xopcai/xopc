import { common } from '@kit.AbilityKit';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { XopcMusicResume, XopcMusicTrack } from '../model/musicPlayback';
import { XopcChatMediaPlayback, XopcChatMediaPlaybackOptions } from './chatMediaPlayback';
import { downloadGeneratedMedia, removeGeneratedMediaFile } from './generatedMediaFile';
import { XopcMusicSystemSession } from './musicSystemSession';
import { readMusicResume, writeMusicResume } from './musicResumeStore';

@ObservedV2
export class XopcGeneratedMusicPlayback {
  @Trace track?: XopcMusicTrack;
  @Trace loading: boolean = false;
  @Trace failed: boolean = false;
  @Trace expanded: boolean = false;
  @Trace position: number = 0;
  @Trace openRevision: number = 0;
  @Trace sourceRevision: number = 0;
  @Trace downloading: boolean = false;
  @Trace private durations: Map<string, number> = new Map<string, number>();
  readonly player: XopcChatMediaPlayback = new XopcChatMediaPlayback();

  private readonly system: XopcMusicSystemSession = new XopcMusicSystemSession();
  private context?: common.UIAbilityContext;
  private gatewayId: string = '';
  private generation: number = 0;
  private path: string = '';
  private lastCheckpoint: number = 0;
  private wantsPlayback: boolean = false;
  private waitingForProfile: boolean = false;
  private openPending: boolean = false;
  private cleanup: Promise<void> = Promise.resolve();
  private releaseOtherAudio?: () => Promise<boolean>;

  get songId(): string { return this.track?.id ?? ''; }

  attach(context: common.UIAbilityContext, releaseOtherAudio: () => Promise<boolean>): void {
    this.context = context;
    this.system.attach(context);
    this.releaseOtherAudio = releaseOtherAudio;
    this.waitingForProfile = true;
  }

  setGateway(id: string): void {
    if (!this.waitingForProfile && this.gatewayId === id) return;
    const context = this.context;
    this.waitingForProfile = false;
    if (this.gatewayId && this.gatewayId !== id) {
      this.durations.clear();
      void this.stop();
    }
    this.gatewayId = id;
    if (!this.track && context && id) {
      const saved = readMusicResume(context.filesDir);
      if (saved?.gatewayId === id && saved.track.id && saved.track.conversationId) {
        this.track = saved.track;
        this.position = Number.isFinite(saved.position) ? Math.max(0, saved.position) : 0;
        this.publish();
      }
    }
    if (this.openPending && id) this.open();
  }

  durationFor(conversationId: string, songId: string, durationMs: number | undefined): number {
    return this.durations.get(JSON.stringify([conversationId, songId])) ?? (durationMs ?? 0) / 1000;
  }

  matches(conversationId: string, songId: string): boolean {
    return this.track?.conversationId === conversationId && this.track.id === songId;
  }

  async play(cacheDir: string, track: XopcMusicTrack): Promise<void> {
    if (this.matches(track.conversationId, track.id)) { await this.toggle(); return; }
    this.track = track;
    this.position = 0;
    await this.load(cacheDir);
  }

  async toggle(): Promise<void> {
    if (this.loading || !this.track) return;
    if (this.player.state === 'playing') await this.pause();
    else await this.resume();
  }

  async resume(): Promise<void> {
    const track = this.track;
    const context = this.context;
    if (!track || this.loading || this.player.state === 'playing') return;
    if (this.failed || ['idle', 'stopped', 'released', 'error'].includes(this.player.state)) {
      if (context) await this.load(context.cacheDir);
      return;
    }
    const generation = this.generation;
    this.wantsPlayback = true;
    if (this.releaseOtherAudio && !await this.releaseOtherAudio()) return;
    if (generation !== this.generation || !this.wantsPlayback) return;
    await this.prepareSystem(track);
    if (generation !== this.generation || !this.wantsPlayback) return;
    if (this.player.state === 'completed') this.seek(0);
    await this.player.play();
  }

  async pause(): Promise<void> {
    this.wantsPlayback = false;
    await this.player.pause();
    if (!this.wantsPlayback) await this.system.suspend();
  }

  private prepareSystem(track: XopcMusicTrack): Promise<void> {
    return this.system.prepare(track, {
      play: (): void => { void this.resume(); },
      pause: (): void => { void this.pause(); },
      stop: (): void => { void this.stop(); },
      seek: (seconds: number): void => { this.seek(seconds); }
    });
  }

  private async load(cacheDir: string): Promise<void> {
    const track = this.track;
    if (!track) return;
    this.resetPlayer();
    const generation = this.generation;
    this.loading = true;
    this.failed = false;
    this.wantsPlayback = true;
    this.publish();
    const path = cacheDir + '/generated-music-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.audio';
    try {
      await this.cleanup;
      if (generation !== this.generation) return;
      const length = await downloadGeneratedMedia('music', track.conversationId, track.id, path,
        (): boolean => generation === this.generation);
      if (generation !== this.generation) { await removeGeneratedMediaFile(path); return; }
      this.path = path;
      const permitted = !this.releaseOtherAudio || await this.releaseOtherAudio();
      if (generation !== this.generation) return;
      const mayPlay = permitted && this.wantsPlayback;
      if (mayPlay) await this.prepareSystem(track);
      if (generation !== this.generation) return;
      const options: XopcChatMediaPlaybackOptions = {
        music: true, initialPosition: this.position,
        onState: (state: string): void => { if (generation === this.generation) this.onPlayerState(state); },
        onPosition: (position: number): void => { if (generation === this.generation) this.onPosition(position); },
        onInterrupt: (): void => { if (generation === this.generation) void this.pause(); }
      };
      await this.player.open(path, length, mayPlay && this.wantsPlayback, (duration: number): void => {
        if (generation === this.generation && Number.isFinite(duration) && duration > 0) {
          this.durations.set(JSON.stringify([track.conversationId, track.id]), duration);
        }
      }, options);
    } catch (_) {
      if (generation === this.generation) this.onPlayerState('error');
    }
  }

  private onPlayerState(state: string): void {
    if (state === 'initialized') return;
    this.loading = false;
    this.failed = state === 'error';
    if (state === 'playing' && !this.wantsPlayback) {
      void this.player.pause();
      return;
    }
    if (state === 'completed' && this.track) {
      this.position = this.durationFor(this.track.conversationId, this.track.id, this.track.durationMs);
    }
    this.publish();
  }

  private onPosition(seconds: number): void {
    this.position = seconds;
    if (Date.now() - this.lastCheckpoint >= 5000) this.checkpoint();
  }

  seek(seconds: number): void {
    if (!this.track || !['playing', 'paused', 'prepared', 'completed'].includes(this.player.state)) return;
    this.player.seek(seconds);
    this.position = this.player.position;
    this.publish();
  }

  checkpoint(): void {
    const context = this.context;
    if (!context || !this.gatewayId || !this.track) return;
    this.lastCheckpoint = Date.now();
    const resume: XopcMusicResume = { gatewayId: this.gatewayId, track: this.track, position: this.position };
    try { writeMusicResume(context.filesDir, resume); }
    catch (_) { hilog.warn(0x0000, 'XopcMusic', 'Could not persist playback position'); }
  }

  onForeground(): void {
    const track = this.track;
    if (track && this.player.state === 'playing') {
      this.system.publish(track, 'playing', this.position, this.durationFor(track.conversationId, track.id, track.durationMs));
    }
  }

  private publish(): void {
    const track = this.track;
    if (track) {
      const state = this.failed ? 'error' : this.loading ? 'loading' : this.player.state;
      this.system.publish(track, state, this.position, this.durationFor(track.conversationId, track.id, track.durationMs));
    }
    this.checkpoint();
  }

  requestOpen(): void { this.openPending = true; this.openRevision++; }

  open(): void {
    this.openPending = false;
    this.expanded = true;
  }

  consumeOpenRequest(): void {
    if (this.openPending) this.open();
  }

  showSource(): void {
    this.expanded = false;
    if (this.track) this.sourceRevision++;
  }

  async download(): Promise<void> {
    const context = this.context;
    const track = this.track;
    if (!context || !track || this.downloading) return;
    const generation = this.generation;
    this.downloading = true;
    const path = context.cacheDir + '/xopc-music-export-' + Date.now() + '.mp3';
    try {
      await downloadGeneratedMedia('music', track.conversationId, track.id, path, (): boolean => generation === this.generation);
      if (generation !== this.generation) return;
      const name = track.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) || 'xopc';
      const locations = await new picker.DocumentViewPicker(context).save({ newFileNames: [name + '.mp3'] });
      if (locations.length && generation === this.generation) {
        const target = await fs.open(locations[0], fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
        try { await fs.copyFile(path, target.fd); } finally { await fs.close(target); }
      }
    } finally {
      await removeGeneratedMediaFile(path);
      this.downloading = false;
    }
  }

  private resetPlayer(): void {
    this.generation++;
    this.wantsPlayback = false;
    const path = this.path;
    this.path = '';
    const stopping = this.player.stop();
    const system = this.system.release();
    this.cleanup = Promise.all([this.cleanup, stopping, system]).then(async (): Promise<void> => {
      await removeGeneratedMediaFile(path);
    });
  }

  stop(): Promise<void> {
    this.resetPlayer();
    this.track = undefined;
    this.position = 0;
    this.loading = false;
    this.failed = false;
    this.expanded = false;
    if (this.context) {
      try { writeMusicResume(this.context.filesDir); }
      catch (_) { hilog.warn(0x0000, 'XopcMusic', 'Could not clear playback position'); }
    }
    return this.cleanup;
  }

  shutdown(): Promise<void> {
    this.checkpoint();
    this.resetPlayer();
    this.loading = false;
    return this.cleanup;
  }
}

export const generatedMusicPlayback: XopcGeneratedMusicPlayback = new XopcGeneratedMusicPlayback();

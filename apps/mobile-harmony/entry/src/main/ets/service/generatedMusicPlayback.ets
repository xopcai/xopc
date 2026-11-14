import { XopcChatMediaPlayback } from './chatMediaPlayback';
import { downloadGeneratedMedia, removeGeneratedMediaFile } from './generatedMediaFile';

@ObservedV2
export class XopcGeneratedMusicPlayback {
  @Trace songId: string = '';
  @Trace loading: boolean = false;
  @Trace failed: boolean = false;
  @Trace private durations: Map<string, number> = new Map<string, number>();
  readonly player: XopcChatMediaPlayback = new XopcChatMediaPlayback();
  private generation: number = 0;
  private path: string = '';
  private cleanup: Promise<void> = Promise.resolve();

  durationFor(songId: string, durationMs: number | undefined): number {
    return this.durations.get(songId) ?? (durationMs ?? 0) / 1000;
  }

  clearDurations(): void {
    this.durations.clear();
  }

  async play(cacheDir: string, conversationId: string, songId: string): Promise<void> {
    if (this.songId === songId && !this.failed && this.player.state !== 'error') {
      if (!this.loading) await this.player.toggle();
      return;
    }

    this.stop();
    const generation = this.generation;
    this.songId = songId;
    this.loading = true;
    const path = cacheDir + '/generated-music-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.audio';
    try {
      await this.cleanup;
      if (generation !== this.generation) return;
      const length = await downloadGeneratedMedia('music', conversationId, songId, path,
        (): boolean => generation === this.generation);
      if (generation !== this.generation) { await removeGeneratedMediaFile(path); return; }
      this.path = path;
      await this.player.open(path, length, true, (seconds: number): void => {
        if (generation === this.generation && Number.isFinite(seconds) && seconds > 0) {
          this.durations.set(songId, seconds);
        }
      });
    } catch (_) {
      if (generation === this.generation) this.failed = true;
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  stop(): Promise<void> {
    this.generation++;
    this.songId = ''; this.loading = false; this.failed = false;
    const path = this.path;
    this.path = '';
    const previous = this.cleanup;
    const stopping = this.player.stop();
    this.cleanup = Promise.all([previous, stopping]).then(async (): Promise<void> => {
      await removeGeneratedMediaFile(path);
    });
    return this.cleanup;
  }
}

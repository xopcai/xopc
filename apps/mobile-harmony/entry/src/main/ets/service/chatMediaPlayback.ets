import { media } from '@kit.MediaKit';
import { fileIo as fs } from '@kit.CoreFileKit';

@ObservedV2
export class XopcChatMediaPlayback {
  @Trace state: string = 'idle';
  @Trace position: number = 0;
  @Trace duration: number = 0;
  @Trace error: string = '';
  private generation: number = 0;
  private player?: media.AVPlayer;
  private file?: fs.File;

  async open(path: string, length: number): Promise<void> {
    const cleanup = this.stop(); const generation = this.generation;
    await cleanup; if (generation !== this.generation) return;
    this.state = 'loading'; this.error = '';
    try {
      const file = await fs.open(path, fs.OpenMode.READ_ONLY);
      if (generation !== this.generation) { await fs.close(file); return; }
      this.file = file;
      const player = await media.createAVPlayer();
      if (generation !== this.generation) { await player.release(); return; }
      this.player = player;
      player.on('stateChange', (state: string): void => {
        if (generation !== this.generation || this.player !== player) return;
        if (state === 'initialized') player.prepare().catch((error: Error): void => { this.fail(error, generation); });
        if (state === 'prepared') this.duration = player.duration / 1000;
        this.state = state;
      });
      player.on('timeUpdate', (time: number): void => { if (generation === this.generation) this.position = time / 1000; });
      player.on('error', (error: Error): void => { this.fail(error, generation); });
      player.fdSrc = { fd: file.fd, offset: 0, length };
    } catch (error) { this.fail(error as Error, generation); }
  }

  async toggle(): Promise<void> {
    const generation = this.generation;
    try {
      if (this.state === 'playing') await this.player?.pause();
      else if (['prepared', 'paused', 'completed'].includes(this.state)) await this.player?.play();
    } catch (error) { this.fail(error as Error, generation); }
  }

  private fail(error: Error, generation: number): void {
    if (generation !== this.generation) return;
    this.stop(); this.error = error.message; this.state = 'error';
  }

  async stop(): Promise<void> {
    this.generation++; this.state = 'idle'; this.position = 0; this.duration = 0; this.error = '';
    const player = this.player; const file = this.file;
    this.player = undefined; this.file = undefined;
    try { await player?.release(); } catch (_) {}
    if (file) { try { await fs.close(file); } catch (_) {} }
  }
}

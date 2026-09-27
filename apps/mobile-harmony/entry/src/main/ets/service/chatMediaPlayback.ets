import { media } from '@kit.MediaKit';
import { fileIo as fs } from '@kit.CoreFileKit';

export type XopcChatMediaPlaybackResult = 'completed' | 'failed' | 'interrupted';

@ObservedV2
export class XopcChatMediaPlayback {
  @Trace state: string = 'idle';
  @Trace position: number = 0;
  @Trace duration: number = 0;
  @Trace error: string = '';
  private generation: number = 0;
  private player?: media.AVPlayer;
  private file?: fs.File;
  private terminalResult?: XopcChatMediaPlaybackResult;
  private terminal?: (result: XopcChatMediaPlaybackResult) => void;

  async open(path: string, length: number, autoPlay: boolean = false): Promise<void> {
    const cleanup = this.stop(); const generation = this.generation;
    await cleanup; if (generation !== this.generation) return;
    this.terminalResult = undefined;
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
        if (state === 'prepared') {
          this.duration = player.duration / 1000;
          if (autoPlay) {
            autoPlay = false;
            player.play().catch((error: Error): void => { this.fail(error, generation); });
          }
        }
        this.state = state;
        if (state === 'completed') this.settle('completed');
      });
      player.on('timeUpdate', (time: number): void => { if (generation === this.generation) this.position = time / 1000; });
      player.on('error', (error: Error): void => { this.fail(error, generation); });
      player.fdSrc = { fd: file.fd, offset: 0, length };
    } catch (error) { this.fail(error as Error, generation); }
  }

  waitForTerminal(): Promise<XopcChatMediaPlaybackResult> {
    if (this.terminalResult) return Promise.resolve(this.terminalResult);
    return new Promise<XopcChatMediaPlaybackResult>((resolve: (result: XopcChatMediaPlaybackResult) => void): void => {
      this.terminal = resolve;
    });
  }

  private settle(result: XopcChatMediaPlaybackResult): void {
    if (this.terminalResult) return;
    this.terminalResult = result;
    const terminal = this.terminal; this.terminal = undefined;
    if (terminal) terminal(result);
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
    this.settle('failed');
    this.stop(); this.error = error.message; this.state = 'error';
  }

  async stop(): Promise<void> {
    this.settle('interrupted');
    this.generation++; this.state = 'idle'; this.position = 0; this.duration = 0; this.error = '';
    const player = this.player; const file = this.file;
    this.player = undefined; this.file = undefined;
    try { await player?.release(); } catch (_) {}
    if (file) { try { await fs.close(file); } catch (_) {} }
  }
}

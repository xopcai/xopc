import { media } from '@kit.MediaKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { audio } from '@kit.AudioKit';

export type XopcChatMediaPlaybackResult = 'completed' | 'failed' | 'interrupted';

export interface XopcChatMediaPlaybackOptions {
  music?: boolean;
  initialPosition?: number;
  onState?: (state: string) => void;
  onPosition?: (position: number) => void;
  onInterrupt?: () => void;
}

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
  private options?: XopcChatMediaPlaybackOptions;

  open(path: string, length: number, autoPlay: boolean = false, onDuration?: (seconds: number) => void,
    options?: XopcChatMediaPlaybackOptions): Promise<void> {
    return this.openSource(path, length, false, autoPlay, onDuration, options);
  }

  openUrl(url: string, autoPlay: boolean = false, onDuration?: (seconds: number) => void,
    options?: XopcChatMediaPlaybackOptions): Promise<void> {
    return this.openSource(url, 0, true, autoPlay, onDuration, options);
  }

  private async openSource(source: string, length: number, remote: boolean, autoPlay: boolean,
    onDuration?: (seconds: number) => void, options?: XopcChatMediaPlaybackOptions): Promise<void> {
    const cleanup = this.stop(); const generation = this.generation;
    await cleanup; if (generation !== this.generation) return;
    this.options = options;
    this.terminalResult = undefined;
    this.state = 'loading'; this.error = '';
    try {
      if (!remote) {
        const file = await fs.open(source, fs.OpenMode.READ_ONLY);
        if (generation !== this.generation) { await fs.close(file); return; }
        this.file = file;
      }
      const player = await media.createAVPlayer();
      if (generation !== this.generation) { await player.release(); return; }
      this.player = player;
      player.on('stateChange', (state: string): void => {
        if (generation !== this.generation || this.player !== player) return;
        this.state = state;
        if (state === 'initialized') {
          try {
            if (options?.music) {
              player.audioRendererInfo = { usage: audio.StreamUsage.STREAM_USAGE_MUSIC, rendererFlags: 0 };
            }
            player.prepare().catch((error: Error): void => { this.fail(error, generation, options); });
          } catch (error) {
            this.fail(error as Error, generation, options);
            return;
          }
        }
        if (state === 'prepared') {
          if (options?.music) player.audioInterruptMode = audio.InterruptMode.INDEPENDENT_MODE;
          this.duration = player.duration / 1000;
          onDuration?.(this.duration);
          if (options?.initialPosition) this.seek(options.initialPosition);
          if (generation !== this.generation) return;
          if (autoPlay) {
            autoPlay = false;
            player.play().catch((error: Error): void => { this.fail(error, generation, options); });
          }
        }
        if (state === 'completed') this.settle('completed');
        options?.onState?.(state);
      });
      player.on('timeUpdate', (time: number): void => {
        if (generation === this.generation) { this.position = time / 1000; options?.onPosition?.(this.position); }
      });
      player.on('seekDone', (time: number): void => {
        if (generation === this.generation) { this.position = time / 1000; options?.onPosition?.(this.position); }
      });
      player.on('error', (error: Error): void => { this.fail(error, generation, options); });
      if (options?.onInterrupt) {
        player.on('audioInterrupt', (event: audio.InterruptEvent): void => {
          if (generation === this.generation && (event.hintType === audio.InterruptHint.INTERRUPT_HINT_PAUSE ||
            event.hintType === audio.InterruptHint.INTERRUPT_HINT_STOP)) options.onInterrupt?.();
        });
      }
      if (remote) player.url = source;
      else if (this.file) player.fdSrc = { fd: this.file.fd, offset: 0, length };
    } catch (error) { this.fail(error as Error, generation, options); }
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
    if (this.state === 'playing') await this.pause();
    else await this.play();
  }

  async play(): Promise<void> {
    const generation = this.generation;
    try {
      if (['prepared', 'paused', 'completed'].includes(this.state)) await this.player?.play();
    } catch (error) { this.fail(error as Error, generation, this.options); }
  }

  async pause(): Promise<void> {
    const generation = this.generation;
    try { if (this.state === 'playing') await this.player?.pause(); }
    catch (error) { this.fail(error as Error, generation, this.options); }
  }

  seek(seconds: number): void {
    if (!['prepared', 'playing', 'paused', 'completed'].includes(this.state)) return;
    const position = Math.max(0, Math.min(seconds, this.duration));
    try {
      this.player?.seek(Math.round(position * 1000));
      this.position = position;
    } catch (error) { this.fail(error as Error, this.generation, this.options); }
  }

  private fail(error: Error, generation: number, options?: XopcChatMediaPlaybackOptions): void {
    if (generation !== this.generation) return;
    this.settle('failed');
    this.stop(); this.error = error.message; this.state = 'error';
    options?.onState?.('error');
  }

  async stop(): Promise<void> {
    this.settle('interrupted');
    this.generation++; this.state = 'idle'; this.position = 0; this.duration = 0; this.error = '';
    const player = this.player; const file = this.file;
    this.options = undefined;
    this.player = undefined; this.file = undefined;
    try { await player?.release(); } catch (_) {}
    if (file) { try { await fs.close(file); } catch (_) {} }
  }
}

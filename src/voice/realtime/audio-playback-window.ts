const MAX_PENDING_BYTES = 96_000; // Two seconds of mono PCM16 at 24 kHz.
const PLAYBACK_TIMEOUT_MS = 15_000;

export class AudioPlaybackWindow {
  private sentBytes = 0;
  private playedBytes = 0;
  private wake?: () => void;

  acknowledge(playedBytes: number): void {
    if (playedBytes > this.sentBytes) throw new Error('Playback acknowledgement exceeds sent audio');
    if (playedBytes <= this.playedBytes) return;
    this.playedBytes = playedBytes;
    this.wake?.();
  }

  async reserve(bytes: number, signal: AbortSignal): Promise<void> {
    if (bytes > MAX_PENDING_BYTES) throw new Error('Audio frame exceeds playback window');
    while (this.sentBytes - this.playedBytes + bytes > MAX_PENDING_BYTES) await this.wait(signal);
    signal.throwIfAborted();
    this.sentBytes += bytes;
  }

  async drain(signal: AbortSignal): Promise<void> {
    while (this.sentBytes > this.playedBytes) await this.wait(signal);
    signal.throwIfAborted();
  }

  private wait(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        this.wake = undefined;
      };
      const onAbort = () => {
        cleanup();
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Voice playback acknowledgement timed out'));
      }, PLAYBACK_TIMEOUT_MS);
      this.wake = () => { cleanup(); resolve(); };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

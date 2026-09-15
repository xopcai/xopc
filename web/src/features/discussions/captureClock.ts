/** Active meeting time excludes deliberate pauses and never depends on wall-clock changes. */
export class CaptureClock {
  private accumulated = 0;
  private started: number | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  get elapsedMs(): number {
    return this.accumulated + (this.started === null ? 0 : Math.max(0, this.now() - this.started));
  }

  resume(): void {
    if (this.started === null) this.started = this.now();
  }

  pause(): void {
    this.accumulated = this.elapsedMs;
    this.started = null;
  }

  reset(elapsedMs = 0): void {
    this.accumulated = elapsedMs;
    this.started = null;
  }
}

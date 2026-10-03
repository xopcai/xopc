export type XopcLoopiMood = 'listen' | 'work' | 'care';

export class XopcLoopiPose {
  lift: number = 0;
  ringAngle: number = 0;
  gaze: number = 0;
  eyeOpen: number = 1;
}

/** Sparse pose changes; native UI interpolation handles the frames between them. */
export class XopcLoopiMotion {
  private timers: number[] = [];
  private running: boolean = false;
  private compact: boolean = false;
  private mood: XopcLoopiMood = 'listen';
  private revision: number = 0;
  private emit: (pose: XopcLoopiPose, durationMs: number) => void;

  constructor(emit: (pose: XopcLoopiPose, durationMs: number) => void) {
    this.emit = emit;
  }

  update(active: boolean, compact: boolean, mood: XopcLoopiMood): void {
    if (this.running === active && this.compact === compact && this.mood === mood) return;
    this.cancel();
    this.running = active;
    this.compact = compact;
    this.mood = mood;
    this.emit(new XopcLoopiPose(), 0);
    if (active) this.later((): void => { this.breathe(); }, 120);
  }

  private later(action: () => void, delayMs: number): void {
    const revision = this.revision;
    const timer = setTimeout((): void => {
      this.timers = this.timers.filter((item: number): boolean => item !== timer);
      if (this.running && revision === this.revision) action();
    }, delayMs);
    this.timers.push(timer);
  }

  private breathe(): void {
    const pose = new XopcLoopiPose();
    pose.lift = this.compact ? -2 : this.mood === 'care' ? -1.5 : -4;
    pose.ringAngle = this.compact ? 0 : this.mood === 'work' ? 2 : -1.2;
    pose.gaze = this.compact ? 0 : this.mood === 'work' ? 2 : (Math.random() - 0.5) * 5;
    this.emit(pose, this.compact ? 220 : 1200);
    this.later((): void => {
      const blink = new XopcLoopiPose();
      blink.eyeOpen = 0.12;
      this.emit(blink, 110);
      this.later((): void => { this.emit(new XopcLoopiPose(), 180); }, 140);
    }, this.compact ? 260 : 1400);
    if (!this.compact) {
      this.later((): void => { this.breathe(); }, 3400 + Math.random() * 2300);
    }
  }

  greet(): void {
    if (!this.running || this.compact) return;
    this.cancel();
    const pose = new XopcLoopiPose();
    pose.lift = -5;
    pose.eyeOpen = 0.25;
    this.emit(pose, 160);
    this.later((): void => { this.emit(new XopcLoopiPose(), 360); }, 450);
    this.later((): void => { this.breathe(); }, 2100);
  }

  private cancel(): void {
    this.revision++;
    this.timers.forEach((timer: number): void => { clearTimeout(timer); });
    this.timers = [];
  }

  dispose(): void {
    this.running = false;
    this.cancel();
  }
}

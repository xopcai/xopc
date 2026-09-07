const MIN_TURN_SILENCE_MS = 1_200;
const FINAL_SETTLE_MS = 350;
const INCOMPLETE_HOLD_MS = 1_800;

/** Conservative continuation hints, not a semantic model or punctuation-based endpoint detector. */
export function needsContinuation(text: string): boolean {
  const tail = text.trim().replace(/[\s，。！？、；：,.!?;:]+$/u, '');
  return /(?:…|\.\.\.)[\s，。！？,.!?]*$/u.test(text)
    || /(?:因为|但是|然后|而且|如果|所以|比如|或者|还有|我想|我要|我觉得|帮我|帮我查一下|帮我查查|请帮我|就是说|那个|这个|呃|嗯)$/u.test(tail)
    || /\b(?:because|but|and|or|if|so|then|um|uh|i want to|i would like to|can you|could you|let me)\s*$/iu.test(tail);
}

/** Joins provider utterances until both transcription and the continuation window have settled. */
export class ConversationTurn {
  private readonly parts = new Map<string, { text?: string; stopped: boolean }>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stoppedAt = 0;

  constructor(private readonly silenceDurationMs: number, private readonly onTurn: (text: string) => void) {}

  start(id: string): void {
    if (this.parts.has(id)) return;
    this.clearTimer();
    this.parts.set(id, { stopped: false });
  }

  stop(id: string): void {
    const part = this.parts.get(id);
    if (part?.stopped) return;
    this.parts.set(id, { ...part, stopped: true });
    this.stoppedAt = Date.now();
    this.schedule();
  }

  final(id: string, text: string): void {
    const part = this.parts.get(id);
    if (part?.text !== undefined) return;
    if (!part?.stopped) this.stoppedAt = Date.now();
    this.parts.set(id, { text: text.trim(), stopped: true });
    if (this.parts.size > 256 || this.text().length > 32_000) {
      this.reset();
      throw new Error('Voice turn input limit reached');
    }
    this.schedule();
  }

  reset(): void {
    this.clearTimer();
    this.parts.clear();
  }

  /** Restore a settled turn if generation was still queued when the user resumed. */
  restore(text: string): void {
    this.parts.set('queued-turn', { text, stopped: true });
    this.clearTimer();
  }

  private text(): string {
    return [...this.parts.values()].map((part) => part.text ?? '').filter(Boolean).join(' ');
  }

  private clearTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    this.clearTimer();
    if ([...this.parts.values()].some((part) => !part.stopped || part.text === undefined)) return;
    const text = this.text();
    if (!text) { this.reset(); return; }
    // The provider has already waited silenceDurationMs before reporting speech_stopped.
    const holdMs = Math.max(FINAL_SETTLE_MS, MIN_TURN_SILENCE_MS - this.silenceDurationMs,
      needsContinuation(text) ? INCOMPLETE_HOLD_MS : 0);
    this.timer = setTimeout(() => {
      this.reset();
      this.onTurn(text);
    }, Math.max(FINAL_SETTLE_MS, this.stoppedAt + holdMs - Date.now()));
  }
}

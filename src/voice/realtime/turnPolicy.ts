const MIN_TURN_SILENCE_MS = 1_200;
const FINAL_SETTLE_MS = 350;
const INCOMPLETE_HOLD_MS = 1_800;
const DECISION_TIMEOUT_MS = 750;
const MAX_TRANSCRIPT_CHARACTERS = 32_000;
const MAX_UTTERANCES = 256;

export type TurnDisposition = 'complete' | 'incomplete' | 'backchannel' | 'wait';
export interface TurnSnapshot { text: string; silenceDurationMs: number }
export interface TurnDecision {
  disposition: TurnDisposition;
  confidence: number;
  holdMs: number;
  source: 'provider' | 'semantic' | 'heuristic';
}
export interface TurnPolicy { decide(snapshot: TurnSnapshot): TurnDecision | Promise<TurnDecision> }

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>).then === 'function';
}

export function hasContinuationHint(text: string): boolean {
  const tail = text.trim().replace(/[\s，。！？、；：,.!?;:]+$/u, '');
  return /(?:…|\.\.\.)[\s，。！？,.!?]*$/u.test(text)
    || /(?:因为|但是|然后|而且|如果|所以|比如|或者|还有|我想|我要|我觉得|帮我|帮我查一下|帮我查查|请帮我|就是说|那个|这个|呃|嗯)$/u.test(tail)
    || /\b(?:because|but|and|or|if|so|then|um|uh|i want to|i would like to|can you|could you|let me)\s*$/iu.test(tail);
}

export const heuristicTurnPolicy: TurnPolicy = {
  decide({ text }) {
    const incomplete = hasContinuationHint(text);
    return { disposition: incomplete ? 'incomplete' : 'complete', confidence: incomplete ? 0.6 : 0.5,
      holdMs: incomplete ? INCOMPLETE_HOLD_MS : 0, source: 'heuristic' };
  },
};

type TurnPart = { text?: string; stopped: boolean };

/** Accumulates provider utterances and commits only after the selected policy settles. */
export class TurnCoordinator {
  private readonly parts = new Map<string, TurnPart>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stoppedAt = 0;
  private decisionGeneration = 0;

  constructor(
    private readonly silenceDurationMs: number,
    private readonly onCommit: (text: string, decision: TurnDecision, turnId: string) => void,
    private readonly policy: TurnPolicy = heuristicTurnPolicy,
  ) {}

  start(id: string): void {
    if (this.parts.has(id)) return;
    this.invalidatePendingDecision();
    this.parts.set(id, { stopped: false });
  }

  stop(id: string): void {
    const part = this.parts.get(id);
    if (part?.stopped) return;
    this.parts.set(id, { ...part, stopped: true });
    this.stoppedAt = Date.now();
    this.evaluate();
  }

  final(id: string, text: string): void {
    const part = this.parts.get(id);
    if (part?.text !== undefined) return;
    if (!part?.stopped) this.stoppedAt = Date.now();
    this.parts.set(id, { text: text.trim(), stopped: true });
    if (this.parts.size > MAX_UTTERANCES || this.text().length > MAX_TRANSCRIPT_CHARACTERS) {
      this.reset();
      throw new Error('Voice turn input limit reached');
    }
    this.evaluate();
  }

  reset(): void { this.invalidatePendingDecision(); this.parts.clear(); }
  restore(id: string, text: string): void { this.invalidatePendingDecision(); this.parts.set(id, { text, stopped: true }); }

  private text(): string { return [...this.parts.values()].map(part => part.text ?? '').filter(Boolean).join(' '); }
  private invalidatePendingDecision(): void { this.decisionGeneration += 1; clearTimeout(this.timer); this.timer = undefined; }

  private evaluate(): void {
    this.invalidatePendingDecision();
    if ([...this.parts.values()].some(part => !part.stopped || part.text === undefined)) return;
    const text = this.text();
    if (!text) { this.reset(); return; }
    const generation = this.decisionGeneration;
    const snapshot = { text, silenceDurationMs: Math.max(0, Date.now() - this.stoppedAt) };
    let result: TurnDecision | Promise<TurnDecision>;
    try { result = this.policy.decide(snapshot); }
    catch { this.schedule(text, heuristicTurnPolicy.decide(snapshot) as TurnDecision, generation); return; }
    if (isPromise(result)) {
      let settled = false;
      const finish = (decision: TurnDecision) => {
        if (settled || generation !== this.decisionGeneration) return;
        settled = true;
        clearTimeout(timeout);
        this.schedule(text, decision, generation);
      };
      const fallback = () => finish(heuristicTurnPolicy.decide(snapshot) as TurnDecision);
      const timeout = setTimeout(fallback, DECISION_TIMEOUT_MS);
      void result.then(finish).catch(fallback);
      return;
    }
    this.schedule(text, result, generation);
  }

  private schedule(text: string, decision: TurnDecision, generation: number): void {
    if (generation !== this.decisionGeneration) return;
    const holdMs = Math.max(FINAL_SETTLE_MS, MIN_TURN_SILENCE_MS - this.silenceDurationMs,
      Number.isFinite(decision.holdMs) ? Math.max(0, decision.holdMs) : 0);
    this.timer = setTimeout(() => {
      if (generation !== this.decisionGeneration) return;
      const turnId = [...this.parts.keys()][0]!;
      if (decision.disposition === 'wait') { this.evaluate(); return; }
      this.reset();
      if (decision.disposition !== 'backchannel') this.onCommit(text, decision, turnId);
    }, Math.max(FINAL_SETTLE_MS, this.stoppedAt + holdMs - Date.now()));
  }
}

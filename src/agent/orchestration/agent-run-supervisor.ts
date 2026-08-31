export type ModelAttemptPlan =
  | { ok: true; timeoutMs: number; remainingMs: number }
  | { ok: false; reason: string };

export interface AgentRunSupervisorOptions {
  timeoutMs: number;
  deadlineAtMs?: number;
  parentSignal?: AbortSignal;
  minimumFallbackMs?: number;
}

/** Minimal run-level coordination: root cancellation and per-attempt deadline planning. */
export class AgentRunSupervisor {
  readonly deadlineAtMs: number;
  readonly signal: AbortSignal;

  private readonly controller = new AbortController();
  private readonly timeout: ReturnType<typeof setTimeout>;
  private readonly forwardParentAbort: () => void;
  private readonly timeoutMs: number;
  private readonly minimumFallbackMs: number;
  private readonly parentSignal?: AbortSignal;

  constructor(options: AgentRunSupervisorOptions) {
    this.timeoutMs = options.timeoutMs;
    this.minimumFallbackMs = options.minimumFallbackMs ?? 5_000;
    this.deadlineAtMs = options.deadlineAtMs ?? Date.now() + options.timeoutMs;
    this.parentSignal = options.parentSignal;
    this.signal = this.controller.signal;
    this.forwardParentAbort = () => this.controller.abort(this.parentSignal?.reason);

    if (this.parentSignal?.aborted) this.forwardParentAbort();
    else this.parentSignal?.addEventListener('abort', this.forwardParentAbort, { once: true });

    this.timeout = setTimeout(
      () => this.controller.abort(new Error('Agent run deadline expired')),
      Math.max(0, this.deadlineAtMs - Date.now()),
    );
  }

  planModelAttempt(isFallback: boolean): ModelAttemptPlan {
    if (this.signal.aborted) return { ok: false, reason: 'Agent run aborted' };
    const remainingMs = this.deadlineAtMs - Date.now();
    if (remainingMs <= 0) {
      return { ok: false, reason: 'Agent run deadline expired before the next model attempt' };
    }
    if (isFallback && remainingMs < this.minimumFallbackMs) {
      return { ok: false, reason: 'Agent run deadline left too little time for a fallback model attempt' };
    }
    return {
      ok: true,
      remainingMs,
      timeoutMs: Math.max(1, Math.min(this.timeoutMs, remainingMs)),
    };
  }

  dispose(): void {
    clearTimeout(this.timeout);
    this.parentSignal?.removeEventListener('abort', this.forwardParentAbort);
  }
}

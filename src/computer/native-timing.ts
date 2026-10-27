import type { ComputerInputTiming } from '@xopcai/computer-control-contract';

type Stage = 'identityCheckMs' | 'actionValidationMs' | 'windowsInputGuardMs' | 'sdkCallMs' | 'resultValidationMs' | 'renderGraceMs';

/** Monotonic, non-overlapping input stages. SDK time includes the native RPC. */
export class ComputerInputTimer {
  private readonly startedAt: number;
  private readonly stages: Record<Stage, number> = {
    identityCheckMs: 0, actionValidationMs: 0, windowsInputGuardMs: 0, sdkCallMs: 0, resultValidationMs: 0, renderGraceMs: 0,
  };
  private sdkCalls = 0;
  constructor(private readonly windows: boolean, private readonly now = () => performance.now()) {
    this.startedAt = now();
  }
  async measure<T>(stage: Stage, operation: () => T | Promise<T>): Promise<T> {
    const start = this.now();
    if (stage === 'sdkCallMs') this.sdkCalls++;
    try { return await operation(); }
    finally { this.stages[stage] += Math.max(0, this.now() - start); }
  }
  measureSync<T>(stage: Stage, operation: () => T): T {
    const start = this.now();
    try { return operation(); }
    finally { this.stages[stage] += Math.max(0, this.now() - start); }
  }
  finish(completed: boolean): ComputerInputTiming {
    const wallMs = Math.max(0, this.now() - this.startedAt);
    return { wallMs, ...this.stages,
      windowsInputGuardMs: this.windows ? this.stages.windowsInputGuardMs : null,
      unattributedMs: Math.max(0, wallMs - Object.values(this.stages).reduce((a, b) => a + b, 0)),
      sdkCalls: this.sdkCalls, completed };
  }
}

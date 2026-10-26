import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export type PhonePhase = 'observation' | 'hierarchy' | 'capture' | 'foreground' | 'screenshot' | 'display'
  | 'dispatch' | 'input' | 'input_confirmation' | 'settle' | 'model_request' | 'model_parse' | 'screen_reading' | 'dex_upload';
export type PhonePhaseMetric = { count: number; errors: number; totalMs: number; maxMs: number };
export type PhoneModelMetric = {
  durationMs?: number; preparationMs?: number; firstByteMs?: number; firstTokenMs?: number; httpStatus?: number;
  promptTokens?: number; completionTokens?: number; totalTokens?: number;
  imageBytes?: number; requestBytes?: number; responseBytes?: number; finishReason?: string;
  errorCode?: string; protocol?: string; prompt?: string; sampling?: string; transport?: string;
};
export type PhonePerformance = {
  operationId: string; durationMs: number; phases: Partial<Record<PhonePhase, PhonePhaseMetric>>;
  modelCalls: PhoneModelMetric[]; droppedModelCalls: number;
};
const context = new AsyncLocalStorage<PhoneExecutionTrace>();
const rounded = (value: number) => Math.round(value * 100) / 100;

/** Numeric, bounded diagnostics only; no screen text, prompts, model output or credentials. */
export class PhoneExecutionTrace {
  readonly id = randomUUID();
  private started = performance.now();
  private phases: PhonePerformance['phases'] = {};
  private calls: PhoneModelMetric[] = [];
  private dropped = 0;
  private endedAt?: number;
  get active(): boolean { return this.endedAt === undefined; }
  finish(): void { this.endedAt ??= performance.now(); }
  run<T>(work: () => T): T { return context.run(this, work); }
  record(phase: PhonePhase, durationMs: number, failed: boolean): void {
    if (!this.active) return;
    const metric = this.phases[phase] ??= { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
    metric.count++; metric.errors += Number(failed); metric.totalMs += durationMs;
    metric.maxMs = Math.max(metric.maxMs, durationMs);
  }
  model(metric: PhoneModelMetric): void {
    if (!this.active) return;
    if (this.calls.length === 120) { this.calls.shift(); this.dropped++; }
    this.calls.push({ ...metric });
  }
  snapshot(): PhonePerformance {
    return { operationId: this.id, durationMs: rounded((this.endedAt ?? performance.now()) - this.started),
      phases: Object.fromEntries(Object.entries(this.phases).map(([phase, metric]) => [phase,
        { ...metric, totalMs: rounded(metric.totalMs), maxMs: rounded(metric.maxMs) }])),
      modelCalls: structuredClone(this.calls), droppedModelCalls: this.dropped };
  }
}
export function currentPhoneTrace(): PhoneExecutionTrace | undefined { const trace = context.getStore(); return trace?.active ? trace : undefined; }

/** Phases can overlap or nest; their sums must not be treated as wall-clock percentages. */
export async function measurePhonePhase<T>(phase: PhonePhase, work: () => Promise<T>): Promise<T> {
  const trace = currentPhoneTrace();
  if (!trace) return work();
  const start = performance.now(); let failed = true;
  try { const result = await work(); failed = false; return result; }
  finally { trace.record(phase, performance.now() - start, failed); }
}

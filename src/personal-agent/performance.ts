import { createLogger } from '../utils/logger.js';

const log = createLogger('PersonalPerformance');
export const PERSONAL_PERFORMANCE_BUDGETS = {
  local_write: { p95Ms: 100, p99Ms: 300 },
  hot_read: { p95Ms: 150 },
  result_to_chat: { p95Ms: 1000 },
  busy_fallback: { p95Ms: 6000 },
  mainRelativeP95: 1.10,
} as const;

export type PersonalPerformanceSample = {
  phase: 'first_text' | 'turn_complete' | 'local_write' | 'hot_read' | 'result_to_chat' | 'reply_persisted' | 'busy_fallback' | 'tool';
  durationMs: number;
  status: 'success' | 'error' | 'cancelled' | 'pending';
  conversationId?: string;
  inputId?: string;
  runId?: string;
  taskId?: string;
  toolCallId?: string;
  tool?: string;
  command?: string;
  deliveryId?: string;
  resultRevision?: number;
  contractVersion?: number;
  assignmentEpoch?: number;
  errorCode?: 'command_blocked' | 'shell_syntax' | 'source_quote_mismatch' | 'patch_envelope' | 'tool_error';
  instructionSequence?: number;
};

/** Bounded diagnostics only; durable history remains in structured logs and the task ledger. */
const capacity = 4096;
const samples: Array<PersonalPerformanceSample & { timestamp: number }> = [];
let next = 0;
export function recordPersonalPerformance(sample: PersonalPerformanceSample): void {
  if (!Number.isFinite(sample.durationMs) || sample.durationMs < 0) return;
  const entry = { ...sample, timestamp: Date.now() };
  if (samples.length < capacity) samples.push(entry);
  else { samples[next] = entry; next = (next + 1) % capacity; }
  log.info(entry, 'Personal chain measurement');
}

export function personalPerformanceSnapshot() {
  return samples.map(sample => ({ ...sample })).sort((a, b) => a.timestamp - b.timestamp);
}

/** Nearest-rank percentiles include all supplied observations; failures are never filtered here. */
export function latencyDistribution(values: readonly number[]) {
  if (values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid latency observation');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number) => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1]! : null;
  return { count: sorted.length, p50Ms: rank(0.5), p95Ms: rank(0.95), p99Ms: rank(0.99), maxMs: sorted.at(-1) ?? null };
}

export function assessMainResponseBudget(baseline: readonly number[], loaded: readonly number[], failures: number, minimumSamples = 40) {
  const reference = latencyDistribution(baseline);
  const workload = latencyDistribution(loaded);
  const ratio = reference.p95Ms && workload.p95Ms !== null ? workload.p95Ms / reference.p95Ms : null;
  const sufficient = reference.count >= minimumSamples && workload.count >= minimumSamples;
  return { baseline: reference, loaded: workload, failures, minimumSamples, ratio,
    limit: PERSONAL_PERFORMANCE_BUDGETS.mainRelativeP95,
    verdict: !sufficient || ratio === null ? 'insufficient_samples' : failures || ratio > PERSONAL_PERFORMANCE_BUDGETS.mainRelativeP95 ? 'failed' : 'passed' };
}

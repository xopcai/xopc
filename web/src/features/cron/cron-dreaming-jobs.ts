import type { CronJob } from '@/features/cron/cron-api';

/**
 * Dreaming phase sweep tokens — keep in sync with
 * `src/agent/memory/dreaming/constants.ts` (`DREAMING_*_SWEEP_TOKEN`).
 */
const DREAMING_SWEEP_TOKENS = new Set<string>([
  '__xopc_memory_dreaming_light_sweep__',
  '__xopc_memory_dreaming_sweep__',
  '__xopc_memory_dreaming_rem_sweep__',
]);

/** True for gateway-managed memory consolidation (“sleep”) cron jobs. */
export function isDreamingManagedCronJob(job: Pick<CronJob, 'payload'>): boolean {
  const p = job.payload;
  if (p?.kind !== 'agentTurn') return false;
  const msg = p.message;
  return typeof msg === 'string' && DREAMING_SWEEP_TOKENS.has(msg);
}

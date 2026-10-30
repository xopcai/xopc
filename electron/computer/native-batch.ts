import { z } from 'zod';

export const EXACT_NATIVE_BATCH_CAPABILITY = 'input.batch.exact.v1';
export type NativeBatchProgress = 'notStarted' | 'started' | 'completed' | 'unknown';

export function supportsExactNativeBatch(inventory: string): boolean {
  try {
    const tools = JSON.parse(inventory).tools;
    return Array.isArray(tools) && tools.some(tool => tool.name === 'run_steps'
      && Array.isArray(tool.capabilities) && tool.capabilities.includes(EXACT_NATIVE_BATCH_CAPABILITY));
  } catch { return false; }
}

const Result = z.object({
  ok: z.boolean(), strict_targets: z.literal(true), total: z.number().int().min(1).max(12),
  executed: z.number().int().min(1).max(12), failed_step: z.number().int().min(0).max(11).nullable(),
  steps: z.array(z.object({ index: z.number().int().min(0).max(11), ok: z.boolean(),
    dispatch: z.enum(['completed', 'unknown', 'not_started']),
  })).min(1).max(12),
});

/** Decode a complete response only; a missing/malformed reply proves no unstarted suffix. */
export function decodeNativeBatchResult(raw: string, count: number, isError: boolean) {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('COMPUTER_DRIVER_INVALID_BATCH_RESULT'); }
  if (isError && z.object({ ok: z.literal(false), code: z.literal('invalid_batch'), executed: z.literal(0),
    steps: z.array(z.never()).max(0).optional() }).safeParse(value).success) {
    return { progress: Array<NativeBatchProgress>(count).fill('notStarted'), errorCode: 'COMPUTER_NATIVE_BATCH_REFUSED' };
  }
  const parsed = Result.safeParse(value);
  const fail = (): never => { throw new Error('COMPUTER_DRIVER_INVALID_BATCH_RESULT'); };
  if (!parsed.success) return fail();
  const result = parsed.data;
  if (result.total !== count || result.executed !== result.steps.length || result.executed > count
    || result.steps.some((step, index) => step.index !== index)
    || (result.ok ? isError || result.failed_step !== null || result.executed !== count
      : !isError || result.failed_step !== result.executed - 1)
    || result.steps.some((step, index) => index < (result.failed_step ?? count)
      ? !step.ok || step.dispatch !== 'completed' : step.ok || step.dispatch === 'completed')) return fail();
  const progress: NativeBatchProgress[] = Array(count).fill('notStarted');
  for (const step of result.steps) progress[step.index] = step.dispatch === 'not_started' ? 'notStarted' : step.dispatch;
  return { progress, ...(result.ok ? {} : { errorCode: 'COMPUTER_NATIVE_BATCH_FAILED' }) };
}

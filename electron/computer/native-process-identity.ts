import { createHash } from 'node:crypto';
import { z } from 'zod';

const Identity = z.object({ pid: z.number().int().positive().max(2147483647),
  start_time: z.string().regex(/^\d{1,20}$/), executable: z.string().min(1).max(4096) });

/** Keep paths private while comparing every fresh incarnation/executable sample. */
export function decodeNativeProcessIdentity(data: unknown, expectedPid: number): string {
  const parsed = Identity.safeParse(data);
  if (!parsed.success || parsed.data.pid !== expectedPid || BigInt(parsed.data.start_time) > 18446744073709551615n) {
    throw new Error('COMPUTER_DRIVER_INVALID_RESULT');
  }
  return `${expectedPid}:kernel:${createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex')}`;
}

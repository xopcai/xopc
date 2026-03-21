import type { JobData } from './types.js';

/**
 * Executable body text from a cron job (`payload` only).
 */
export function getCronPayloadText(job: Pick<JobData, 'payload'>): string {
  const p = job.payload;
  if (p.kind === 'systemEvent') return p.text;
  return p.message;
}

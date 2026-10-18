import { createHash } from 'node:crypto';

export interface RecentToolCall {
  name: string;
  params: unknown;
  resultPreview?: string;
  revision?: string;
}

function fingerprint(call: RecentToolCall): string {
  // Receipt paths and test timings change even when the command adds no evidence.
  const normalized = call.name === 'exec_command' ? { ...call, resultPreview: call.resultPreview
    ?.replace(/^Log: [^\n]*$/gm, 'Log: [recorded]')
    .replace(/^(\s*(?:# |ℹ )?duration_ms:? )\d+(?:\.\d+)?$/gm, '$1[timing]') } : call;
  const value = JSON.stringify(normalized, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  return createHash('sha256').update(value).digest('hex');
}

/** Warn on a stalled tail, without removing tools needed to recover or verify a repair. */
export function detectToolLoops(recentCalls: readonly RecentToolCall[]): { injection: string | null } {
  const calls = recentCalls.slice(-12);
  const last = calls.at(-1);
  if (!last) return { injection: null };
  const hashes = calls.map(fingerprint);
  let count = 0;
  for (let index = hashes.length - 1; index >= 0 && hashes[index] === hashes.at(-1); index--) count++;
  const alternating = [2, 3].some(period => hashes.length >= period * 2
    && hashes.slice(-period * 2, -period).every((hash, index) => hash === hashes.at(-period + index)));
  if (count < 2 && !alternating) return { injection: null };
  return { injection: `Repeated tool calls are producing no new evidence (${last.name}, ${count >= 2 ? `${count} identical calls` : 'repeated cycle'}). Change the query or fix the cause before retrying. For a running job use managed_job wait. Tools remain available for a different argument or a changed workspace.` };
}

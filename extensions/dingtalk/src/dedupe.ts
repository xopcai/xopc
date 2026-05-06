const seen = new Map<string, number>();
const TTL_MS = 5 * 60 * 1000;

function prune(now: number): void {
  for (const [k, t] of seen) {
    if (now - t > TTL_MS) seen.delete(k);
  }
}

/** Returns true if this id was already seen (duplicate). */
export function checkAndMarkDingtalkMessage(accountId: string, protocolMessageId?: string, businessMsgId?: string): boolean {
  const now = Date.now();
  prune(now);
  const keys: string[] = [];
  if (protocolMessageId) keys.push(`${accountId}:p:${protocolMessageId}`);
  if (businessMsgId) keys.push(`${accountId}:b:${businessMsgId}`);
  for (const k of keys) {
    if (seen.has(k)) return true;
  }
  for (const k of keys) {
    seen.set(k, now);
  }
  return false;
}

import { parseSessionKey } from '@/lib/session-key';

/** Agent id encoded in a session key (`{agentId}:{source}:…` or legacy `gateway:{agentId}:…`). */
export function getAgentIdFromWebSessionKey(key: string): string | null {
  const parsed = parseSessionKey(key);
  const id = parsed?.agentId?.trim().toLowerCase();
  return id || null;
}

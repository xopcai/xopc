/**
 * Web UI session keys: `{agentId}:webchat|gateway:default:direct:{peerId}`.
 */
export function getAgentIdFromWebSessionKey(key: string): string | null {
  const parts = key.split(':').filter(Boolean);
  if (parts.length < 5) return null;
  const source = parts[1]?.toLowerCase();
  if (source !== 'webchat' && source !== 'gateway') return null;
  const id = parts[0]?.trim().toLowerCase();
  return id || null;
}

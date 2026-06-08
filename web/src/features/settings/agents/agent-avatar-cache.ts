/** Bumped after a successful custom avatar upload so `<img>` URLs bypass browser cache. */
const revisions = new Map<string, number>();

export const AGENT_AVATAR_UPDATED_EVENT = 'xopc-agent-avatar-updated';

export function bumpAgentAvatarCacheRevision(agentId: string): number {
  const next = (revisions.get(agentId) ?? 0) + 1;
  revisions.set(agentId, next);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AGENT_AVATAR_UPDATED_EVENT, { detail: { agentId } }));
  }
  return next;
}

export function getAgentAvatarCacheRevision(agentId: string): number {
  return revisions.get(agentId) ?? 0;
}

/** Test-only — clears in-memory revision state between cases. */
export function __resetAgentAvatarCacheForTests(): void {
  revisions.clear();
}

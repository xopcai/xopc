/**
 * Persisted last-known agent list. Lets the chat header render the agent
 * name + model picker instantly on cold start instead of flashing a blank
 * pill until /api/agents responds.
 */
import type { ChatAgentsPayload } from '../../query/agents';

import {
  QUERY_CACHE_NAMESPACES,
  clearQueryCache,
  readQueryCache,
  writeQueryCache,
} from './query-cache';

export function readCachedAgents(profileId: string | null | undefined): ChatAgentsPayload | null {
  return readQueryCache<ChatAgentsPayload>(QUERY_CACHE_NAMESPACES.agents, profileId);
}

export function writeCachedAgents(
  profileId: string | null | undefined,
  payload: ChatAgentsPayload,
): void {
  writeQueryCache(QUERY_CACHE_NAMESPACES.agents, profileId, undefined, payload);
}

export function clearCachedAgents(profileId: string | null | undefined): void {
  clearQueryCache(QUERY_CACHE_NAMESPACES.agents, profileId);
}

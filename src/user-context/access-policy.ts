import type { Config } from '../config/schema.js';
import type { KnowledgeSource } from '../knowledge-memory/index.js';
import { getConversationRouting } from '../routing/session-key.js';
import { getSessionConfig } from '../storage/sqlite/config-repository.js';

export interface UserContextSessionAccess {
  enabled: boolean;
  userModel: boolean;
  knowledge: boolean;
  crossSessionHistory: boolean;
  knowledgeSources: readonly KnowledgeSource[];
}

/** One policy boundary for every shared-context read and write path. */
export function resolveUserContextSessionAccess(
  config: Config | undefined,
  conversationId: string | undefined,
): UserContextSessionAccess {
  if (!config || !conversationId) {
    return { enabled: false, userModel: false, knowledge: false, crossSessionHistory: false, knowledgeSources: [] };
  }
  const session = getConversationRouting(conversationId);
  const mode = getSessionConfig(conversationId)?.userContextMode ?? 'enabled';
  const enabled = Boolean(config.userContext.enabled && session?.peerKind === 'direct' && mode === 'enabled');
  return {
    enabled,
    userModel: enabled && config.userContext.userModel.enabled,
    knowledge: enabled && config.userContext.knowledgeMemory.enabled,
    crossSessionHistory: enabled,
    knowledgeSources: enabled && config.userContext.knowledgeMemory.enabled
      ? config.userContext.knowledgeMemory.sources
      : [],
  };
}

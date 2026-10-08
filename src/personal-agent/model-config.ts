import type { ThinkLevel } from '../agent/transcript/thinking-types.js';
import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { RuntimePolicySchema } from '../agent-config/index.js';
import { resolveEffectiveAgentConfigForSession } from '../config/agent-profile.js';
import type { SessionAgentConfig } from '../session/config-types.js';
import { getSessionConfig, updateSessionConfig } from '../storage/sqlite/config-repository.js';
import { getSessionMetadata } from '../storage/sqlite/session-repository.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { isPersonalConversation } from './repository.js';

/** Personal AI has one conversation; its Agent is the source of model preferences. */
export function syncPersonalModelConfig(conversationId: string): SessionAgentConfig | null {
  const existing = getSessionConfig(conversationId);
  if (!isPersonalConversation(conversationId)) return existing;
  const effective = resolveEffectiveAgentConfigForSession(conversationId).config;
  const modelOverride = effective.models.chat.primary;
  const thinkingLevel = effective.runtime.thinkingLevel ?? 'off';
  if (existing?.modelOverride === modelOverride && existing.thinkingLevel === thinkingLevel && existing.fixedModel) return existing;
  return updateSessionConfig(conversationId, { modelOverride, thinkingLevel, fixedModel: true }, process.cwd());
}

export function savePersonalModelConfig(conversationId: string, model: string, thinkingLevel: ThinkLevel): SessionAgentConfig {
  return runSqliteWriteTransaction(() => {
    const agentId = getSessionMetadata(conversationId)!.agentId;
    const repository = new AgentCatalogRepository();
    const agent = repository.get(agentId)!;
    const { revision: _revision, provisioningState: _state, provisioningError: _error,
      createdAt: _created, updatedAt: _updated, deletedAt: _deleted, ...entry } = agent;
    repository.update(agentId, agent.revision, {
      ...entry,
      models: { ...agent.models, chat: { ...agent.models?.chat, primary: model, fallbacks: agent.models?.chat?.fallbacks ?? [] } },
      runtime: { ...agent.runtime, thinkingLevel: RuntimePolicySchema.shape.thinkingLevel.parse(thinkingLevel) },
    });
    return updateSessionConfig(conversationId, { modelOverride: model, thinkingLevel, fixedModel: true }, process.cwd());
  });
}

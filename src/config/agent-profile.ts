import {
  resolveEffectiveAgentConfig,
  type EffectiveAgentConfig,
  type ResolveEffectiveAgentConfigResult,
} from '../agent-config/index.js';
import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { normalizeAgentId, resolveAgentWorkspaceDir } from '../agent/agent-scope.js';
import { agentExists, getDefaultAgentId } from '../routing/resolve-route.js';
import { getConversationRouting } from '../routing/session-key.js';

export { resolveAgentWorkspaceDir } from '../agent/agent-scope.js';

export interface EffectiveAgentTools {
  denied: Set<string>;
}

export interface EffectiveAgentProfile {
  agentId: string;
  config: EffectiveAgentConfig;
  sources: ResolveEffectiveAgentConfigResult['sources'];
  resolvedWorkspacePath: string;
  primaryModelRef: string;
  fallbacks: string[];
  customInstructions?: string;
  skillsAllowlist?: string[];
  skillsDenylist: string[];
  tools: EffectiveAgentTools;
  params: Record<string, unknown>;
}

export function extractProfileAgentId(conversationId: string | undefined | null): string {
  if (!conversationId) return getDefaultAgentId();
  const routing = getConversationRouting(conversationId);
  if (!routing || !agentExists(routing.agentId)) {
    throw new Error(`Conversation agent is unavailable: ${conversationId}`);
  }
  return routing.agentId;
}

export function resolveEffectiveAgentConfigForAgent(
  agentId: string,
): ResolveEffectiveAgentConfigResult {
  const catalog = new AgentCatalogRepository().snapshot();
  const agent = catalog.agents.find(
    (entry) => entry.enabled !== false && normalizeAgentId(entry.id) === normalizeAgentId(agentId),
  );
  if (!agent) throw new Error(`No enabled agent found for "${agentId}"`);
  return resolveEffectiveAgentConfig({
    agent,
    defaults: catalog.defaults,
    defaultWorkspace: (id) => resolveAgentWorkspaceDir(id),
  });
}

export function resolveEffectiveAgentConfigForSession(
  conversationId: string | undefined | null,
): ResolveEffectiveAgentConfigResult {
  return resolveEffectiveAgentConfigForAgent(extractProfileAgentId(conversationId));
}

export function resolveEffectiveAgentProfile(agentId: string): EffectiveAgentProfile {
  const resolved = resolveEffectiveAgentConfigForAgent(agentId);
  const effective = resolved.config;
  const deniedTools = Object.entries(effective.tools)
    .filter(([, policy]) => policy.mode === 'deny')
    .map(([name]) => name);
  const skillsAllowlist = effective.skills.mode === 'selected' ? [...effective.skills.include] : undefined;
  const skillsDenylist = effective.skills.mode === 'all-enabled' ? [...effective.skills.exclude] : [];

  return {
    agentId: effective.id,
    config: effective,
    sources: resolved.sources,
    resolvedWorkspacePath: resolveAgentWorkspaceDir(effective.id),
    primaryModelRef: effective.models.chat.primary,
    fallbacks: [...effective.models.chat.fallbacks],
    customInstructions: effective.profile?.instructions,
    skillsAllowlist,
    skillsDenylist,
    tools: { denied: new Set(deniedTools) },
    params: {},
  };
}

export function resolveEffectiveAgentProfileForSession(
  conversationId: string | undefined | null,
): EffectiveAgentProfile {
  return resolveEffectiveAgentProfile(extractProfileAgentId(conversationId));
}

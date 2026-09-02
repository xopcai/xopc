import {
  resolveEffectiveAgentConfig,
  type EffectiveAgentConfig,
  type ResolveEffectiveAgentConfigResult,
} from '../agent-config/index.js';
import { normalizeAgentId, resolveAgentWorkspaceDir } from '../agent/agent-scope.js';
import { agentExists, getDefaultAgentId } from '../routing/resolve-route.js';
import { parseSessionKey } from '../routing/session-key.js';
import type { Config } from './schema.js';

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

function findAgent(config: Config, agentId: string) {
  const id = normalizeAgentId(agentId);
  return config.agents.list.find((agent) => agent.enabled !== false && normalizeAgentId(agent.id) === id);
}

export function extractProfileAgentId(sessionKey: string | undefined | null, config: Config): string {
  const parsed = parseSessionKey(sessionKey ?? '');
  if (!parsed) return getDefaultAgentId(config);
  const id = parsed.agentId;
  if (id === 'subagent' || id.startsWith('subagent:') || !agentExists(id, config)) {
    return getDefaultAgentId(config);
  }
  return id.toLowerCase();
}

export function resolveEffectiveAgentConfigForAgent(
  config: Config,
  agentId: string,
): ResolveEffectiveAgentConfigResult {
  const agent = findAgent(config, agentId) ?? findAgent(config, getDefaultAgentId(config));
  if (!agent) throw new Error(`No enabled agent found for "${agentId}"`);
  return resolveEffectiveAgentConfig({
    agent,
    defaults: config.agents.defaults,
    defaultWorkspace: (id) => resolveAgentWorkspaceDir(config, id),
  });
}

export function resolveEffectiveAgentConfigForSession(
  config: Config,
  sessionKey: string | undefined | null,
): ResolveEffectiveAgentConfigResult {
  return resolveEffectiveAgentConfigForAgent(config, extractProfileAgentId(sessionKey, config));
}

export function resolveEffectiveAgentProfile(config: Config, agentId: string): EffectiveAgentProfile {
  const resolved = resolveEffectiveAgentConfigForAgent(config, agentId);
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
    resolvedWorkspacePath: resolveAgentWorkspaceDir(config, effective.id),
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
  config: Config,
  sessionKey: string | undefined | null,
): EffectiveAgentProfile {
  return resolveEffectiveAgentProfile(config, extractProfileAgentId(sessionKey, config));
}

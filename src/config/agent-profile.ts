import { resolveEffectiveAgentManifest, type EffectiveAgentManifest } from '../agent-manifest/index.js';
import { normalizeAgentId, resolveAgentWorkspaceDir } from '../agent/agent-scope.js';
import type { ThinkLevel, ReasoningLevel, VerboseLevel } from '../agent/transcript/thinking-types.js';
import { agentExists, getDefaultAgentId } from '../routing/resolve-route.js';
import { parseSessionKey } from '../routing/session-key.js';
import type { Config } from './schema.js';

export { resolveAgentWorkspaceDir } from '../agent/agent-scope.js';

export interface EffectiveAgentTools {
  denied: Set<string>;
}

export interface EffectiveAgentProfile {
  agentId: string;
  manifest: EffectiveAgentManifest;
  resolvedWorkspacePath: string;
  primaryModelRef: string | undefined;
  fallbacks: string[];
  thinkingDefault?: ThinkLevel;
  reasoningDefault?: ReasoningLevel;
  verboseDefault?: VerboseLevel;
  systemPromptOverride?: string;
  skillsAllowlist?: string[];
  tools: EffectiveAgentTools;
  params: Record<string, unknown>;
}

function findAgentManifest(config: Config, agentId: string) {
  const id = normalizeAgentId(agentId);
  return config.agents.list.find((agent) => agent.enabled !== false && normalizeAgentId(agent.id) === id);
}

export function extractProfileAgentId(sessionKey: string | undefined | null, config: Config): string {
  const parsed = parseSessionKey(sessionKey ?? '');
  if (!parsed) {
    return getDefaultAgentId(config);
  }
  const aid = parsed.agentId;
  if (aid === 'subagent' || aid.startsWith('subagent:')) {
    return getDefaultAgentId(config);
  }
  if (!agentExists(aid, config)) {
    return getDefaultAgentId(config);
  }
  return aid.toLowerCase();
}

export function resolveEffectiveAgentManifestForAgent(config: Config, agentId: string): EffectiveAgentManifest {
  const agent = findAgentManifest(config, agentId) ?? findAgentManifest(config, getDefaultAgentId(config));
  if (!agent) {
    throw new Error(`No enabled agent manifest found for "${agentId}"`);
  }
  return resolveEffectiveAgentManifest({
    agent,
    presets: config.agents.capabilityPresets,
  }).manifest;
}

export function resolveEffectiveAgentManifestForSession(
  config: Config,
  sessionKey: string | undefined | null,
): EffectiveAgentManifest {
  return resolveEffectiveAgentManifestForAgent(config, extractProfileAgentId(sessionKey, config));
}

export function resolveEffectiveAgentProfile(config: Config, agentId: string): EffectiveAgentProfile {
  const manifest = resolveEffectiveAgentManifestForAgent(config, agentId);
  const defaultModel = manifest.models.roles[manifest.models.defaultRole]?.model;
  const deniedTools = Object.entries(manifest.tools.builtin)
    .filter(([, policy]) => policy.mode === 'deny')
    .map(([name]) => name);
  const skillsAllowlist = manifest.skills.mode === 'allowlist' ? [...(manifest.skills.allow ?? [])] : undefined;

  return {
    agentId: manifest.id,
    manifest,
    resolvedWorkspacePath: resolveAgentWorkspaceDir(config, manifest.id),
    primaryModelRef: defaultModel?.trim() || undefined,
    fallbacks: [],
    systemPromptOverride: manifest.prompt?.customInstructions,
    skillsAllowlist,
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

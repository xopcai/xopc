/**
 * Effective agent profile: merges `agents.defaults` with `agents.list` entry.
 * Subagent session keys fall back to the configured default agent id for profile lookup.
 */

import type { ThinkLevel, ReasoningLevel, VerboseLevel } from '../agent/transcript/thinking-types.js';
import type { Config } from './schema.js';
import type { AgentModelConfig } from './schema.js';
import { getAgentDefaultModelRef } from './schema.js';
import { resolveAgentWorkspaceDir } from '../agent/agent-scope.js';
import { getDefaultAgentId, agentExists } from '../routing/resolve-route.js';
import { parseSessionKey } from '../routing/session-key.js';

export { resolveAgentWorkspaceDir } from '../agent/agent-scope.js';

export type { AgentModelConfig };

export interface EffectiveAgentTools {
  /** Tool names to exclude (merged: union of defaults + list entry disables). */
  disable: Set<string>;
}

export interface EffectiveAgentProfile {
  agentId: string;
  /** Resolved absolute Markdown workspace path (tool cwd, attachments, daily memory/, …). */
  resolvedWorkspacePath: string;
  /** Primary model ref (provider/model); may be empty → runtime default. */
  primaryModelRef: string | undefined;
  fallbacks: string[];
  thinkingDefault?: ThinkLevel;
  reasoningDefault?: ReasoningLevel;
  verboseDefault?: VerboseLevel;
  systemPromptOverride?: string;
  /** When set, only these skill names appear in `<available_skills>`. */
  skillsAllowlist?: string[];
  tools: EffectiveAgentTools;
  params: Record<string, unknown>;
}

function mergeModelConfig(
  base: AgentModelConfig | undefined,
  override: AgentModelConfig | undefined,
): AgentModelConfig | undefined {
  if (override === undefined) return base;
  if (base === undefined) return override;
  return {
    primary: override.primary ?? base.primary,
    fallbacks: override.fallbacks ?? base.fallbacks,
  };
}

function primaryAndFallbacksFromModelConfig(
  raw: AgentModelConfig | undefined,
): { primary?: string; fallbacks: string[] } {
  const primary = raw?.primary?.trim();
  const fallbacks = Array.isArray(raw?.fallbacks)
    ? raw.fallbacks.map((s) => s.trim()).filter(Boolean)
    : [];
  return { primary: primary || undefined, fallbacks };
}

function mergeDisableLists(a?: string[], b?: string[]): Set<string> {
  const out = new Set<string>();
  for (const x of a ?? []) {
    const s = String(x).trim();
    if (s) {
      out.add(s);
    }
  }
  for (const x of b ?? []) {
    const s = String(x).trim();
    if (s) {
      out.add(s);
    }
  }
  return out;
}

/**
 * Agent id used for config lookup from a session key (subagent keys → default agent).
 */
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

/**
 * Merge `agents.defaults` with the matching `agents.list` entry.
 */
export function resolveEffectiveAgentProfile(config: Config, agentId: string): EffectiveAgentProfile {
  const defaults = config.agents?.defaults;
  const list = config.agents?.list;
  const entry = Array.isArray(list)
    ? list.find((a) => a && a.enabled !== false && a.id.toLowerCase() === agentId.toLowerCase())
    : undefined;

  const resolvedWorkspacePath = resolveAgentWorkspaceDir(config, agentId);

  const mergedModel = mergeModelConfig(defaults?.model, entry?.model);
  const { primary: primaryFromMerged, fallbacks: fallbacksFromMerged } = primaryAndFallbacksFromModelConfig(mergedModel);
  const globalDefault = getAgentDefaultModelRef(config);
  const primaryModelRef = primaryFromMerged?.trim() || globalDefault;

  const disable = mergeDisableLists(
    defaults?.tools?.disable as string[] | undefined,
    entry?.tools?.disable as string[] | undefined,
  );

  const params: Record<string, unknown> = {
    ...(defaults?.params as Record<string, unknown> | undefined),
    ...(entry?.params as Record<string, unknown> | undefined),
  };

  return {
    agentId: agentId.toLowerCase(),
    resolvedWorkspacePath,
    primaryModelRef,
    fallbacks: fallbacksFromMerged,
    thinkingDefault: entry?.thinkingDefault ?? defaults?.thinkingDefault,
    reasoningDefault: entry?.reasoningDefault ?? defaults?.reasoningDefault,
    verboseDefault: entry?.verboseDefault ?? defaults?.verboseDefault,
    systemPromptOverride: entry?.systemPromptOverride?.trim()
      ? entry.systemPromptOverride
      : defaults?.systemPromptOverride?.trim()
        ? defaults.systemPromptOverride
        : undefined,
    skillsAllowlist: entry?.skills?.length ? [...entry.skills] : defaults?.skills?.length ? [...defaults.skills] : undefined,
    tools: { disable },
    params,
  };
}

export function resolveEffectiveAgentProfileForSession(
  config: Config,
  sessionKey: string | undefined | null,
): EffectiveAgentProfile {
  const id = extractProfileAgentId(sessionKey, config);
  return resolveEffectiveAgentProfile(config, id);
}

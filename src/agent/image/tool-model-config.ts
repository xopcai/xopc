import type { AgentModelConfig, Config } from '../../config/schema.js';
import {
  getAgentDefaultImageModelConfig,
  getAgentDefaultModelRef,
  parseModelRef,
} from '../../config/schema.js';
import { resolveEffectiveAgentConfigForAgent } from '../../config/agent-profile.js';
import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
} from '../../config/model-input.js';
import { resolveDefaultAgentId } from '../agent-scope.js';
import {
  getDefaultModelSync,
  getModelsByProvider,
  isProviderConfiguredSync,
  resolveModel,
} from '../../providers/index.js';
import { buildCapabilityPlansForConfig } from '../../capabilities/readiness/index.js';

export type ToolModelConfig = {
  primary?: string;
  fallbacks?: string[];
  timeoutMs?: number;
  autoProviderFallback?: boolean;
};

export type ImageModelResolutionSource = 'explicit' | 'auto-role' | 'auto-provider' | 'none';

export type ResolvedImageModelConfig = ToolModelConfig & {
  source: ImageModelResolutionSource;
  roleId?: string;
  roleDescription?: string;
};

export function hasToolModelConfig(model: ToolModelConfig | undefined): boolean {
  return Boolean(
    model?.primary?.trim() || (model?.fallbacks ?? []).some((entry) => entry.trim().length > 0),
  );
}

export function resolveDefaultModelRef(cfg?: Config): { provider: string; model: string } {
  const ref = cfg ? getAgentDefaultModelRef(cfg) : undefined;
  if (ref) {
    const p = parseModelRef(ref);
    if (p) {
      return p;
    }
  }
  const fallback = getDefaultModelSync(cfg);
  const p2 = parseModelRef(fallback);
  if (p2) {
    return p2;
  }
  return { provider: 'deepseek', model: 'deepseek-v4-flash' };
}

export function coerceToolModelConfig(model?: AgentModelConfig): ToolModelConfig {
  const primary = resolveAgentModelPrimaryValue(model);
  const fallbacks = resolveAgentModelFallbackValues(model);
  return {
    ...(primary?.trim() ? { primary: primary.trim() } : {}),
    ...(fallbacks.length > 0 ? { fallbacks } : {}),
  };
}

function resolveEffectiveModelsConfig(params: {
  cfg?: Config;
  agentId?: string;
}): {
  chat: AgentModelConfig;
  intents: Record<string, AgentModelConfig | undefined>;
  imageUnderstanding?: AgentModelConfig;
} | undefined {
  if (!params.cfg) {
    return undefined;
  }
  try {
    const agentId = params.agentId?.trim() || resolveDefaultAgentId(params.cfg);
    return resolveEffectiveAgentConfigForAgent(params.cfg, agentId).config.models;
  } catch {
    return undefined;
  }
}

export function resolveConfiguredImageModelConfig(params: {
  cfg?: Config;
  agentId?: string;
}): ToolModelConfig {
  const models = resolveEffectiveModelsConfig(params);
  const config = models?.imageUnderstanding ?? (params.cfg ? getAgentDefaultImageModelConfig(params.cfg) : undefined);
  return coerceToolModelConfig(config);
}

function modelRefSupportsImage(modelRef: string): boolean {
  try {
    return resolveModel(modelRef).input?.includes('image') === true;
  } catch {
    return false;
  }
}

function configuredImageModelRef(modelRef: string): string | null {
  const trimmed = modelRef.trim();
  const parsed = parseModelRef(trimmed);
  if (!parsed || !isProviderConfiguredSync(parsed.provider)) {
    return null;
  }
  return modelRefSupportsImage(trimmed) ? trimmed : null;
}

function addCandidate(
  candidates: Array<{ ref: string; roleId?: string; roleDescription?: string }>,
  seen: Set<string>,
  entry: { ref: string; roleId?: string; roleDescription?: string },
): void {
  const ref = configuredImageModelRef(entry.ref);
  if (!ref || seen.has(ref)) {
    return;
  }
  seen.add(ref);
  candidates.push({
    ref,
    ...(entry.roleId ? { roleId: entry.roleId } : {}),
    ...(entry.roleDescription ? { roleDescription: entry.roleDescription } : {}),
  });
}

function collectRoleImageModelCandidates(params: {
  cfg?: Config;
  agentId?: string;
}): Array<{ ref: string; roleId?: string; roleDescription?: string }> {
  const models = resolveEffectiveModelsConfig(params);
  const routes = models ? { chat: models.chat, ...models.intents } : {};
  const roleIds = Object.keys(routes);
  const seen = new Set<string>();
  const candidates: Array<{ ref: string; roleId?: string; roleDescription?: string }> = [];

  for (const roleId of roleIds) {
    const role = routes[roleId];
    if (!role) {
      continue;
    }
    const refs = [role.primary, ...role.fallbacks];
    for (const ref of refs) {
      addCandidate(candidates, seen, {
        ref,
        roleId,
      });
    }
  }

  return candidates;
}

function resolveDefaultModelRefForAgent(params: {
  cfg?: Config;
  agentId?: string;
}): { provider: string; model: string } {
  const models = resolveEffectiveModelsConfig(params);
  const ref = models?.chat.primary.trim();
  if (ref) {
    const parsed = parseModelRef(ref);
    if (parsed) {
      return parsed;
    }
  }
  return resolveDefaultModelRef(params.cfg);
}

export function buildToolModelConfigFromCandidates(params: {
  explicit: ToolModelConfig;
  candidates: Array<string | null | undefined>;
  source?: ImageModelResolutionSource;
}): ResolvedImageModelConfig | null {
  if (hasToolModelConfig(params.explicit)) {
    return { ...params.explicit, source: 'explicit' };
  }

  const deduped: string[] = [];
  for (const candidate of params.candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed || !trimmed.includes('/')) {
      continue;
    }
    const provider = trimmed.slice(0, trimmed.indexOf('/')).trim();
    if (!provider || !isProviderConfiguredSync(provider)) {
      continue;
    }
    if (!deduped.includes(trimmed)) {
      deduped.push(trimmed);
    }
  }

  if (deduped.length === 0) {
    return null;
  }

  return {
    primary: deduped[0],
    ...(deduped.length > 1 ? { fallbacks: deduped.slice(1) } : {}),
    source: params.source ?? 'auto-provider',
  };
}

function firstVisionModelRef(provider: string): string | undefined {
  const m = getModelsByProvider(provider).find((x) => x.input?.includes('image'));
  return m ? `${provider}/${m.id}` : undefined;
}

/**
 * Effective image understanding model inferred from configured providers.
 */
export function resolveEffectiveImageModelConfig(params: {
  cfg?: Config;
  agentId?: string;
}): ResolvedImageModelConfig | null {
  const explicit = resolveConfiguredImageModelConfig(params);
  if (hasToolModelConfig(explicit)) {
    const managed = params.cfg ? buildCapabilityPlansForConfig(params.cfg).vision : undefined;
    const managedRefs = managed?.primary
      ? [managed.primary, ...managed.fallbacks].map((candidate) => `${candidate.provider}/${candidate.model}`)
      : [];
    const fallbacks = [...new Set([...(explicit.fallbacks ?? []), ...managedRefs])]
      .filter((ref) => ref !== explicit.primary);
    return {
      ...explicit,
      ...(fallbacks.length > 0 ? { fallbacks } : {}),
      source: 'explicit',
    };
  }

  const roleCandidates = collectRoleImageModelCandidates(params);
  if (roleCandidates.length > 0) {
    const [first, ...rest] = roleCandidates;
    return {
      primary: first!.ref,
      ...(rest.length > 0 ? { fallbacks: rest.map((entry) => entry.ref) } : {}),
      source: 'auto-role',
      ...(first!.roleId ? { roleId: first!.roleId } : {}),
      ...(first!.roleDescription ? { roleDescription: first!.roleDescription } : {}),
    };
  }

  const primary = resolveDefaultModelRefForAgent(params);
  const primaryCandidates: string[] = [];
  const vision = firstVisionModelRef(primary.provider);
  if (vision) {
    primaryCandidates.push(vision);
  }

  const managed = params.cfg
    ? buildCapabilityPlansForConfig(params.cfg).vision
    : undefined;
  const managedRefs = managed?.primary
    ? [managed.primary, ...managed.fallbacks].map((candidate) => `${candidate.provider}/${candidate.model}`)
    : [];

  return buildToolModelConfigFromCandidates({
    explicit,
    candidates: [
      ...primaryCandidates,
      ...managedRefs,
    ],
    source: 'auto-provider',
  });
}

export function resolveImageModelConfigForTool(params: {
  cfg?: Config;
  agentId?: string;
}): ResolvedImageModelConfig | null {
  return resolveEffectiveImageModelConfig(params);
}

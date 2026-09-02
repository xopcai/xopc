import {
  AgentDefaultsSchema,
  AgentEntrySchema,
  EffectiveAgentConfigSchema,
  type AgentDefaults,
  type AgentEntry,
  type EffectiveAgentConfig,
  type SkillDefaults,
  type SkillOverride,
} from './schema.js';

export type AgentConfigSource = 'system' | 'global' | 'agent';

export interface ResolveEffectiveAgentConfigResult {
  config: EffectiveAgentConfig;
  sources: Record<string, AgentConfigSource>;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function resolveSkills(defaults: SkillDefaults, override: SkillOverride | undefined): SkillDefaults {
  if (!override) return structuredClone(defaults);
  if (override.mode === 'replace') {
    return { mode: 'selected', include: unique(override.include).sort() };
  }

  const additions = new Set(unique(override.add));
  const removals = new Set(unique(override.remove));
  if (defaults.mode === 'selected') {
    const include = new Set(defaults.include);
    for (const skill of additions) include.add(skill);
    for (const skill of removals) include.delete(skill);
    return { mode: 'selected', include: [...include].sort() };
  }

  const exclude = new Set(defaults.exclude);
  for (const skill of additions) exclude.delete(skill);
  for (const skill of removals) exclude.add(skill);
  return { mode: 'all-enabled', exclude: [...exclude].sort() };
}

function clearSources(path: string, sources: Record<string, AgentConfigSource>): void {
  for (const sourcePath of Object.keys(sources)) {
    if (sourcePath === path || sourcePath.startsWith(`${path}.`)) {
      delete sources[sourcePath];
    }
  }
}

function markObjectSources(
  value: unknown,
  source: AgentConfigSource,
  basePath: string,
  sources: Record<string, AgentConfigSource>,
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    sources[basePath] = source;
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    markObjectSources(child, source, basePath ? `${basePath}.${key}` : key, sources);
  }
}

export function resolveEffectiveAgentConfig(params: {
  defaults: AgentDefaults;
  agent: AgentEntry;
  defaultWorkspace?: (agentId: string) => string;
}): ResolveEffectiveAgentConfigResult {
  const defaults = AgentDefaultsSchema.parse(params.defaults);
  const agent = AgentEntrySchema.parse(params.agent);
  const sources: Record<string, AgentConfigSource> = {};
  markObjectSources(defaults, 'global', '', sources);

  const intents = structuredClone(defaults.models.intents);
  for (const [intent, route] of Object.entries(agent.models?.intents ?? {})) {
    if (route === null) {
      delete intents[intent as keyof typeof intents];
      clearSources(`models.intents.${intent}`, sources);
    } else if (route !== undefined) {
      intents[intent as keyof typeof intents] = structuredClone(route);
      markObjectSources(route, 'agent', `models.intents.${intent}`, sources);
    }
  }

  const models = {
    chat: structuredClone(agent.models?.chat ?? defaults.models.chat),
    intents,
    ...(agent.models?.imageUnderstanding === null
      ? {}
      : agent.models?.imageUnderstanding
        ? { imageUnderstanding: structuredClone(agent.models.imageUnderstanding) }
        : defaults.models.imageUnderstanding
          ? { imageUnderstanding: structuredClone(defaults.models.imageUnderstanding) }
          : {}),
    ...(agent.models?.imageGeneration === null
      ? {}
      : agent.models?.imageGeneration
        ? { imageGeneration: structuredClone(agent.models.imageGeneration) }
        : defaults.models.imageGeneration
          ? { imageGeneration: structuredClone(defaults.models.imageGeneration) }
          : {}),
  };

  if (agent.models?.chat) markObjectSources(agent.models.chat, 'agent', 'models.chat', sources);
  if (agent.models && Object.hasOwn(agent.models, 'imageUnderstanding')) {
    clearSources('models.imageUnderstanding', sources);
    if (agent.models.imageUnderstanding) {
      markObjectSources(agent.models.imageUnderstanding, 'agent', 'models.imageUnderstanding', sources);
    }
  }
  if (agent.models && Object.hasOwn(agent.models, 'imageGeneration')) {
    clearSources('models.imageGeneration', sources);
    if (agent.models.imageGeneration) {
      markObjectSources(agent.models.imageGeneration, 'agent', 'models.imageGeneration', sources);
    }
  }

  const tools = { ...structuredClone(defaults.tools), ...structuredClone(agent.tools ?? {}) };
  for (const [tool, policy] of Object.entries(agent.tools ?? {})) {
    markObjectSources(policy, 'agent', `tools.${tool}`, sources);
  }

  const skills = resolveSkills(defaults.skills, agent.skills);
  if (agent.skills) {
    clearSources('skills', sources);
    markObjectSources(skills, 'agent', 'skills', sources);
  }

  const workflows = {
    ...structuredClone(defaults.workflows),
    ...structuredClone(agent.workflows ?? {}),
  };
  if (agent.workflows) markObjectSources(agent.workflows, 'agent', 'workflows', sources);

  const runtime = {
    ...structuredClone(defaults.runtime),
    ...structuredClone(agent.runtime ?? {}),
  };
  if (agent.runtime) markObjectSources(agent.runtime, 'agent', 'runtime', sources);

  const workspace = agent.workspace ?? params.defaultWorkspace?.(agent.id) ?? `~/.xopc/workspace/${agent.id}`;
  sources.workspace = agent.workspace ? 'agent' : 'system';
  if (agent.profile) markObjectSources(agent.profile, 'agent', 'profile', sources);

  return {
    config: EffectiveAgentConfigSchema.parse({
      id: agent.id,
      enabled: agent.enabled,
      workspace,
      ...(agent.profile ? { profile: structuredClone(agent.profile) } : {}),
      models,
      skills,
      tools,
      workflows,
      runtime,
    }),
    sources,
  };
}

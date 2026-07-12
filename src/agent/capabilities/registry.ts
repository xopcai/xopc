import {
  AGENT_CAPABILITY_DEFINITIONS,
  type AgentCapabilityActivationSource,
  type AgentCapabilityCatalogEntry,
  type AgentCapabilityDefinition,
  type AgentCapabilitySessionState,
} from './definitions.js';

const definitionsById: Map<string, AgentCapabilityDefinition> = new Map(
  AGENT_CAPABILITY_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function listAgentCapabilities(): AgentCapabilityDefinition[] {
  return [...AGENT_CAPABILITY_DEFINITIONS];
}

export function getAgentCapability(id: string): AgentCapabilityDefinition | undefined {
  return definitionsById.get(id.trim());
}

export function getAgentCapabilityToolNames(ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const definition = getAgentCapability(id);
    if (!definition) continue;
    for (const toolName of definition.tools) {
      if (seen.has(toolName)) continue;
      seen.add(toolName);
      out.push(toolName);
    }
  }
  return out;
}

export function resolveAgentCapabilityCatalog(options: {
  registeredToolNames?: readonly string[];
  lazyToolNames?: readonly string[];
  deniedToolNames?: readonly string[];
} = {}): AgentCapabilityCatalogEntry[] {
  const available = new Set([
    ...(options.registeredToolNames ?? []),
    ...(options.lazyToolNames ?? []),
  ]);
  const denied = new Set(options.deniedToolNames ?? []);
  return AGENT_CAPABILITY_DEFINITIONS.map((definition) => {
    const availableTools = definition.tools.filter((toolName) => available.has(toolName) && !denied.has(toolName));
    const unavailableTools = definition.tools.filter((toolName) => !availableTools.includes(toolName));
    return {
      ...definition,
      availableTools,
      unavailableTools,
    };
  });
}

export function createAgentCapabilitySessionState(
  id: string,
  source: AgentCapabilityActivationSource,
  now = Date.now(),
): AgentCapabilitySessionState | null {
  const definition = getAgentCapability(id);
  if (!definition) return null;
  return {
    id: definition.id,
    source,
    activatedAt: now,
    ttl: definition.activation.ttl,
    status: 'collecting',
  };
}

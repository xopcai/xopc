/**
 * Named model roles from the selected agent manifest.
 */

import type { AgentTypedModel, Config } from './schema.js';
import { parseModelRef } from './schema.js';
import { listAgentEntries, normalizeAgentId } from '../agent/agent-scope.js';

export type { AgentTypedModel };

function rolesToEntries(
  roles: Record<string, { model: string; description?: string }> | undefined,
): AgentTypedModel[] {
  return Object.entries(roles ?? {}).map(([id, role]) => ({
    id,
    ...role,
  }));
}

export function resolveEffectiveTypedModels(config: Config, agentId: string): Map<string, AgentTypedModel> {
  const out = new Map<string, AgentTypedModel>();
  const id = normalizeAgentId(agentId);
  const entry = listAgentEntries(config).find(
    (candidate) => candidate.enabled !== false && normalizeAgentId(candidate.id) === id,
  );
  for (const modelRole of rolesToEntries(entry?.models?.roles)) {
    out.set(modelRole.id, modelRole);
  }
  return out;
}

/** Resolve a typed model id to `provider/model`, or undefined when not configured. */
export function resolveTypedModelRef(
  config: Config,
  agentId: string,
  typeId: string,
): string | undefined {
  const entry = resolveEffectiveTypedModels(config, agentId).get(typeId);
  const ref = entry?.model?.trim();
  return ref || undefined;
}

function parseModelRefInput(ref: string): { directRef?: string; typeId?: string } {
  const trimmed = ref.trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed.includes('/')) {
    return { directRef: trimmed };
  }
  const typeId = trimmed.startsWith('@') ? trimmed.slice(1).trim() : trimmed;
  return typeId ? { typeId } : {};
}

/**
 * Resolve a model reference: `provider/model`, typed id (`small`), or `@small`.
 * Throws when the ref is invalid or the typed id is unknown.
 */
export function resolveModelRef(config: Config, agentId: string, ref: string): string {
  const { directRef, typeId } = parseModelRefInput(ref);
  if (directRef) {
    if (!parseModelRef(directRef)) {
      throw new Error(`model ref must be provider/model format (got '${directRef}')`);
    }
    return directRef;
  }
  if (typeId) {
    const resolved = resolveTypedModelRef(config, agentId, typeId);
    if (resolved) {
      return resolved;
    }
    const available = [...resolveEffectiveTypedModels(config, agentId).keys()];
    const hint =
      available.length > 0 ? ` (available: ${available.join(', ')})` : ' (none configured)';
    throw new Error(`Unknown typed model id '${typeId}' for agent '${agentId}'${hint}`);
  }
  throw new Error('model ref must not be empty');
}

/**
 * Named model roles (`agents.defaults.models` / `agents.list[].models`).
 * Merged per agent id for workflow and other callers.
 */

import { listAgentEntries } from '../agent/agent-scope.js';
import type { AgentTypedModel, Config } from './schema.js';
import { parseModelRef } from './schema.js';

export type { AgentTypedModel };

/**
 * Merge defaults + per-agent typed models. Agent entry wins on same `id`.
 */
export function mergeTypedModels(
  defaults?: AgentTypedModel[],
  entry?: AgentTypedModel[],
): Map<string, AgentTypedModel> {
  const out = new Map<string, AgentTypedModel>();
  for (const m of defaults ?? []) {
    out.set(m.id, m);
  }
  for (const m of entry ?? []) {
    out.set(m.id, m);
  }
  return out;
}

export function resolveEffectiveTypedModels(config: Config, agentId: string): Map<string, AgentTypedModel> {
  const defaults = config.agents?.defaults?.models;
  const entry = listAgentEntries(config).find(
    (a) => a.enabled !== false && a.id.toLowerCase() === agentId.toLowerCase(),
  )?.models;
  return mergeTypedModels(defaults, entry);
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

import type { EffectiveAgentManifest } from '../agent-manifest/schema.js';

export interface ResolveModelRoleParams {
  manifest: EffectiveAgentManifest;
  role?: string;
}

export interface ResolvedModelRole {
  role: string;
  model: string;
  description?: string;
}

export function resolveModelRole(params: ResolveModelRoleParams): ResolvedModelRole {
  const requested = params.role?.trim() || params.manifest.models.defaultRole;
  const role = params.manifest.models.roles[requested] ? requested : params.manifest.models.defaultRole;
  const entry = params.manifest.models.roles[role];
  if (!entry) {
    throw new Error(`Model role "${role}" is not configured`);
  }
  return {
    role,
    model: entry.model,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
  };
}

import type { Config } from '../config/schema.js';
import { agentExists, getDefaultAgentId } from '../routing/resolve-route.js';
import type { ProjectService } from './project-service.js';

function normalizeAgentId(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

export function resolveProjectAgentId(input: {
  config: Config;
  projects: ProjectService;
  explicitAgentId?: string | null;
  projectId?: string | null;
}): string {
  const fallback = getDefaultAgentId();
  const explicitAgentId = normalizeAgentId(input.explicitAgentId);
  if (explicitAgentId) {
    if (!agentExists(explicitAgentId)) throw new Error(`Agent not found: ${explicitAgentId}`);
    return explicitAgentId;
  }

  const projectId = input.projectId?.trim();
  const projectAgentId = projectId ? normalizeAgentId(input.projects.get(projectId)?.defaultAgentId) : undefined;
  if (projectAgentId && agentExists(projectAgentId)) {
    return projectAgentId;
  }
  return fallback;
}

export function isValidProjectAgentId(config: Config, agentId: string | null | undefined): boolean {
  const normalized = normalizeAgentId(agentId);
  return !normalized || agentExists(normalized);
}

export function normalizeProjectAgentId(agentId: string | null | undefined): string | undefined {
  return normalizeAgentId(agentId);
}

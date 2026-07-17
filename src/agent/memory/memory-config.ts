import { join } from 'node:path';

import type { Config } from '../../config/schema.js';
import { resolveUserMemoryPath } from '../../config/paths.js';
import { resolveEffectiveAgentManifestForAgent } from '../../config/agent-profile.js';
import { resolveAgentHomeDir, resolveAgentIdForWorkspacePath } from '../agent-scope.js';

import type { MemoryStoreConfig } from './types.js';

/** When false, curated `memories/` (under agent home) + external memory providers are off. */
export function isMemorySubsystemEnabled(config: Config | undefined): boolean {
  if (!config) return true;
  return config.agents.list.some((agent) => agent.enabled !== false && agent.memory.mode !== 'off');
}

/** Curated memory tool + agent-home `memories/` store (not injected into system prompt). */
export function isCuratedMemoryInPrompt(config: Config | undefined): boolean {
  if (!config) return true;
  return config.agents.list.some((agent) => agent.enabled !== false && agent.memory.sources.includes('curated'));
}

export function resolveBuiltinMemoryStoreConfig(
  workspaceDir: string,
  config: Config | undefined,
  requestedAgentId?: string,
): MemoryStoreConfig {
  const agentId = config != null
    ? requestedAgentId?.trim() || resolveAgentIdForWorkspacePath(config, workspaceDir)
    : undefined;
  const manifest = config && agentId ? resolveEffectiveAgentManifestForAgent(config, agentId) : undefined;
  const memoriesDir =
    config != null
      ? join(
          resolveAgentHomeDir(config, agentId ?? 'main'),
          'memories',
        )
      : join(workspaceDir, 'memories');
  return {
    workspaceDir,
    memoriesDir,
    userMemoryPath: config != null ? resolveUserMemoryPath() : join(workspaceDir, 'user', 'MEMORY.md'),
    memoryCharLimit: manifest?.memory.retention?.maxChars ?? 2200,
    userCharLimit: 1375,
    userProfileEnabled: manifest?.memory.sources.includes('userProfile') ?? true,
  };
}

/**
 * Whether to prefix the user message with prefetched external memory this turn.
 * `first-turn` only injects on turn 1. `contextCadence` N injects on turns 1, N+1, 2N+1, …
 */
export function shouldPlanUserContextThisTurn(
  _config: Config | undefined,
  turnNumber: number,
): boolean {
  return turnNumber >= 1;
}

export function shouldRegisterCuratedMemoryTool(config: Config | undefined): boolean {
  return isCuratedMemoryInPrompt(config);
}

import { join } from 'node:path';

import type { Config } from '../../config/schema.js';
import { resolveUserMemoryPath } from '../../config/paths.js';
import { resolveUserDir } from '../../config/paths.js';

import type { MemoryStoreConfig } from './types.js';

/** When false, shared curated memory and external memory providers are off. */
export function isMemorySubsystemEnabled(config: Config | undefined): boolean {
  if (!config) return true;
  return config.userContext.enabled && config.userContext.memory.mode !== 'off';
}

/** Curated memory tool + shared user `memories/` store (not injected into system prompt). */
export function isCuratedMemoryInPrompt(config: Config | undefined): boolean {
  if (!config) return true;
  return config.userContext.enabled && config.userContext.memory.sources.includes('curated');
}

export function resolveBuiltinMemoryStoreConfig(
  workspaceDir: string,
  config: Config | undefined,
  _requestedAgentId?: string,
): MemoryStoreConfig {
  const memoriesDir = config != null ? join(resolveUserDir(), 'memories') : join(workspaceDir, 'memories');
  return {
    workspaceDir,
    memoriesDir,
    userMemoryPath: config != null ? resolveUserMemoryPath() : join(workspaceDir, 'user', 'MEMORY.md'),
    memoryCharLimit: config?.userContext.memory.retention?.maxChars ?? 2200,
    userCharLimit: 1375,
    userProfileEnabled: config?.userContext.memory.sources.includes('userProfile') ?? true,
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

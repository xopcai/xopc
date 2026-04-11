import { join } from 'node:path';

import type { Config } from '../../config/schema.js';
import { resolveAgentHomeDir, resolveAgentIdForWorkspacePath } from '../../agents/agent-scope.js';

import type { MemoryStoreConfig } from './types.js';

/** When false, curated `.xopcbot/memories/` + external memory providers are off. */
export function isMemorySubsystemEnabled(config: Config | undefined): boolean {
  return config?.agents?.defaults?.memory?.enabled !== false;
}

/** Curated snapshot + `curated_memory` tool (agent home `memories/`). */
export function isCuratedMemoryInPrompt(config: Config | undefined): boolean {
  const m = config?.agents?.defaults?.memory;
  if (m?.enabled === false) {
    return false;
  }
  if (m?.useEnhancedSystem === false) {
    return false;
  }
  return true;
}

export function resolveBuiltinMemoryStoreConfig(
  workspaceDir: string,
  config: Config | undefined,
): MemoryStoreConfig {
  const m = config?.agents?.defaults?.memory;
  const memoriesDir =
    config != null
      ? join(
          resolveAgentHomeDir(config, resolveAgentIdForWorkspacePath(config, workspaceDir)),
          'memories',
        )
      : join(workspaceDir, '.xopcbot', 'memories');
  return {
    workspaceDir,
    memoriesDir,
    memoryCharLimit: m?.memoryCharLimit ?? 2200,
    userCharLimit: m?.userCharLimit ?? 1375,
    userProfileEnabled: m?.userProfileEnabled !== false,
  };
}

/**
 * Whether to prefix the user message with prefetched external memory this turn.
 * `first-turn` only injects on turn 1. `contextCadence` N injects on turns 1, N+1, 2N+1, …
 */
export function shouldInjectMemoryPrefetchThisTurn(
  config: Config | undefined,
  turnNumber: number,
): boolean {
  const m = config?.agents?.defaults?.memory;
  const freq = m?.injectionFrequency ?? 'every-turn';
  if (freq === 'first-turn') {
    return turnNumber === 1;
  }
  const cadence = m?.contextCadence ?? 1;
  if (cadence <= 1) {
    return true;
  }
  return (turnNumber - 1) % cadence === 0;
}

export function shouldRegisterCuratedMemoryTool(config: Config | undefined): boolean {
  return isCuratedMemoryInPrompt(config);
}

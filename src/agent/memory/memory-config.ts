import type { Config } from '../../config/schema.js';

/** Whether generic workspace and provider-backed memory is available. */
export function isMemorySubsystemEnabled(config: Config | undefined): boolean {
  if (!config) return true;
  return config.userContext.enabled && config.userContext.memory.mode !== 'off';
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

/**
 * Session management utilities for CLI commands
 */

import { SessionIndex } from '../../session/index.js';
import { loadConfig } from '../../config/loader.js';

/**
 * Get initialized SessionManager instance
 * Eliminates repeated initialization boilerplate
 */
export async function getSessionIndex(): Promise<SessionIndex> {
  const config = loadConfig();
  const manager = new SessionIndex({ config });
  await manager.initialize();
  return manager;
}

/**
 * Get session manager and handle errors consistently
 */
/** @deprecated Use {@link getSessionIndex}. */
export const getSessionManager = getSessionIndex;

export async function getSessionIndexSafe(): Promise<
  { manager: SessionIndex; error: null } | { manager: null; error: Error }
> {
  try {
    const manager = await getSessionIndex();
    return { manager, error: null };
  } catch (error) {
    return { manager: null, error: error as Error };
  }
}

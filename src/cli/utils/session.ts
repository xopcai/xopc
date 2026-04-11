/**
 * Session management utilities for CLI commands
 */

import { SessionManager } from '../../session/index.js';
import { loadConfig } from '../../config/loader.js';

/**
 * Get initialized SessionManager instance
 * Eliminates repeated initialization boilerplate
 */
export async function getSessionManager(): Promise<SessionManager> {
  const config = loadConfig();
  const manager = new SessionManager({ config });
  await manager.initialize();
  return manager;
}

/**
 * Get session manager and handle errors consistently
 */
export async function getSessionManagerSafe(): Promise<
  { manager: SessionManager; error: null } | { manager: null; error: Error }
> {
  try {
    const manager = await getSessionManager();
    return { manager, error: null };
  } catch (error) {
    return { manager: null, error: error as Error };
  }
}

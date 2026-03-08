/**
 * Session management utilities for CLI commands
 */

import { SessionManager } from '../../session/index.js';

/**
 * Get initialized SessionManager instance
 * Eliminates repeated initialization boilerplate
 */
export async function getSessionManager(workspace: string): Promise<SessionManager> {
  const manager = new SessionManager({ workspace });
  await manager.initialize();
  return manager;
}

/**
 * Get session manager and handle errors consistently
 */
export async function getSessionManagerSafe(
  workspace: string
): Promise<{ manager: SessionManager; error: null } | { manager: null; error: Error }> {
  try {
    const manager = await getSessionManager(workspace);
    return { manager, error: null };
  } catch (error) {
    return { manager: null, error: error as Error };
  }
}

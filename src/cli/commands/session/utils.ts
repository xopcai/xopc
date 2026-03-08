/**
 * Session command utilities
 */

import { getSessionManager } from '../../utils/session.js';
import { getContextWithOpts } from '../../index.js';
import type { SessionManager } from '../../../session/index.js';

/**
 * Get initialized session manager
 */
export async function getManager(): Promise<SessionManager> {
  const ctx = getContextWithOpts();
  return getSessionManager(ctx.workspacePath);
}

/**
 * Collect multiple option values into array
 */
export function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

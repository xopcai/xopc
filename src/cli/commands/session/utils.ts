/**
 * Session command utilities
 */

import { getSessionManager } from '../../utils/session.js';
import { getContextWithOpts } from '../../context.js';
import type { SessionIndex } from '../../../session/index.js';

/**
 * Get initialized session manager
 */
export async function getManager(): Promise<SessionIndex> {
  getContextWithOpts();
  return getSessionManager();
}

/**
 * Collect multiple option values into array
 */
export function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

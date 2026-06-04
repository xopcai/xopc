/**
 * Workspace-path domain helpers that need both `Config` (from `./schema.js`)
 * and agent-scope helpers (from `../agent/agent-scope.js`).
 *
 * Lives in this file rather than `./schema.js` because schema.ts is the leaf
 * type module — letting it import agent-scope creates a circular cycle
 * (`schema → agent-scope → schema`). Callers import via the `./index.js` barrel.
 */

import { getDefaultWorkspacePath } from '../agent/agent-scope.js';
import type { Config } from './schema.js';

/**
 * Default agent's resolved Markdown workspace root
 * (`resolveAgentWorkspaceDir` for the default agent id).
 */
export function getWorkspacePath(config: Config): string {
  return getDefaultWorkspacePath(config);
}

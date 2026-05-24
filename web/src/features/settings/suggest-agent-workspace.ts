/**
 * Default workspace path suggestion for a new agent (`~/.xopc/workspace/<agentId>`; parent is `agents.defaults.workspace`).
 */

import { normalizeAgentId } from '@/lib/agent-id';

/** Gateway default when `agents.defaults.workspace` is unset. */
export const DEFAULT_AGENT_WORKSPACE = '~/.xopc/workspace';

/** Empty string if `name` is blank; else `~/.xopc/workspace/<agentId>`. */
export function suggestWorkspaceFromAgentName(name: string): string {
  const t = name.trim();
  if (!t) {
    return '';
  }
  const id = normalizeAgentId(t);
  return `${DEFAULT_AGENT_WORKSPACE}/${id}`;
}

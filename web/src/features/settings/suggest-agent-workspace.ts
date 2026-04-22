/**
 * Default workspace path suggestion for a new agent (`~/.xopc/workspace-<agentId>`).
 */

import { normalizeAgentId } from '@/lib/agent-id';

/** Empty string if `name` is blank; else `~/.xopc/workspace-<agentId>`. */
export function suggestWorkspaceFromAgentName(name: string): string {
  const t = name.trim();
  if (!t) {
    return '';
  }
  const id = normalizeAgentId(t);
  return `~/.xopc/workspace-${id}`;
}

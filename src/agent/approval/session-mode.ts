import type { ActionApprovalMode } from '@xopcai/gateway-contract';

import { resolveEffectiveAgentConfigForSession } from '../../config/agent-profile.js';
import { getSessionConfig } from '../../storage/sqlite/config-repository.js';
import { TaskConversationRepository } from '../../tasks/task-conversation-repository.js';
import { TaskOriginRepository } from '../../tasks/task-origin-repository.js';

/** A delegated task cannot escape a requesting conversation's current approval ceiling. */
export function resolveSessionActionApprovalMode(conversationId: string, seen = new Set<string>()): ActionApprovalMode {
  if (seen.has(conversationId) || seen.size >= 16) return 'ask';
  seen.add(conversationId);
  const own = getSessionConfig(conversationId)?.actionApprovalMode
    ?? resolveEffectiveAgentConfigForSession(conversationId).config.runtime.actionApprovalMode ?? 'full';
  if (own === 'ask') return own;
  const task = new TaskConversationRepository().resolveActiveExecutionSession(conversationId);
  if (task) for (const parent of new TaskOriginRepository().conversationIds(task.taskId)) {
    if (parent === conversationId) continue;
    try { if (resolveSessionActionApprovalMode(parent, new Set(seen)) === 'ask') return 'ask'; }
    catch { return 'ask'; }
  }
  return own;
}

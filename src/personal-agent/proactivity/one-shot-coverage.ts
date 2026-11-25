import type { TaskWait } from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { listActiveTaskWaits } from '../../tasks/task-wait-reader.js';

export function isActionableOneShotWait(
  wait: TaskWait | undefined,
): wait is TaskWait & { kind: 'user_input' | 'approval' } {
  return Boolean(
    wait
    && (wait.kind === 'user_input' || wait.kind === 'approval')
    && wait.condition.type !== 'connection',
  );
}

/**
 * Returns true if an explicit one-shot follow-up governs (ownerId, taskId, waitId) —
 * including active, delivered, stopped, expired, or resolved_before_check records for that exact waitId —
 * so Proactive Hub / duplicate notifications never re-emit the same pending item as a generic alert.
 */
export function hasCoveringOneShotFollowUp(
  ownerId: string,
  taskId: string,
  waitId?: string,
): boolean {
  if (!taskId) return false;
  const db = getSqliteDatabase();
  if (waitId) {
    const exact = db
      .prepare(`
        SELECT 1 FROM personal_attention_threads
        WHERE owner_id = ? AND follow_up_mode = 'one_shot' AND task_id = ? AND wait_id = ?
          AND (status = 'active' OR terminal_reason IN ('delivered', 'stopped', 'expired', 'resolved_before_check', 'task_closed'))
        LIMIT 1
      `)
      .get(ownerId, taskId, waitId);
    return Boolean(exact);
  }
  // When an event only carries taskId without waitId, check if the task has a single active actionable wait governed by a one-shot follow-up.
  const activeWaits = listActiveTaskWaits(taskId).filter(isActionableOneShotWait);
  if (activeWaits.length === 1) {
    const singleWaitId = activeWaits[0]!.id;
    const matched = db
      .prepare(`
        SELECT 1 FROM personal_attention_threads
        WHERE owner_id = ? AND follow_up_mode = 'one_shot' AND task_id = ? AND wait_id = ?
          AND (status = 'active' OR terminal_reason IN ('delivered', 'stopped', 'expired', 'resolved_before_check', 'task_closed'))
        LIMIT 1
      `)
      .get(ownerId, taskId, singleWaitId);
    return Boolean(matched);
  }
  return false;
}

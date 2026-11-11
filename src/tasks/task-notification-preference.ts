import { personalRequestForTask } from '../personal-agent/request-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { TaskContextRepository } from './task-context-repository.js';

export const TASK_NOTIFICATION_PREFERENCES = ['default', 'final_only', 'updates'] as const;
export type TaskNotificationPreference = typeof TASK_NOTIFICATION_PREFERENCES[number];

export function isTaskNotificationPreference(value: unknown): value is TaskNotificationPreference {
  return TASK_NOTIFICATION_PREFERENCES.some(preference => preference === value);
}

export function taskNotificationContext(conversationId: string, preference: TaskNotificationPreference) {
  return { targetKind: 'source' as const, targetId: `task-notifications:${conversationId}`, role: 'reference' as const, pinned: false, retrievalPolicy: {},
    metadata: { kind: 'task_notification_preference', preference } };
}

export function setTaskNotificationPreference(taskId: string, conversationId: string, preference: TaskNotificationPreference) {
  new TaskContextRepository().add({ taskId, ...taskNotificationContext(conversationId, preference), createdBy: { kind: 'user' } });
}

export function getTaskNotificationPreference(taskId: string, conversationId: string): TaskNotificationPreference {
  const row = getSqliteDatabase().prepare(`SELECT json_extract(metadata_json, '$.preference') AS preference FROM context_edges
    WHERE owner_kind = 'task' AND owner_id = ? AND target_kind = 'source' AND target_id = 'task-notifications:' || ? AND role = 'reference'
      AND json_extract(metadata_json, '$.kind') = 'task_notification_preference'`).get(taskId, conversationId);
  const value = row?.preference ?? personalRequestForTask(taskId)?.parameters.notificationPreference;
  return isTaskNotificationPreference(value) ? value : 'default';
}

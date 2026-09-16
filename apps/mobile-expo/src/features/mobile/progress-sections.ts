import type { TaskListItem } from '../../query/tasks';

/** Closed is not necessarily successful; retain the server's resolution in the UI. */
export function recentClosedTasks(items: TaskListItem[]): TaskListItem[] {
  return items.filter(({ task }) => task.phase === 'closed')
    .sort((a, b) => (b.task.closedAt ?? b.task.updatedAt) - (a.task.closedAt ?? a.task.updatedAt))
    .slice(0, 5);
}

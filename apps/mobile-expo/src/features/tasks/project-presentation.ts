import type { ProjectTaskCard } from '@xopcai/gateway-contract';

import type { Project } from '../../query/projects';
import type { TaskListItem } from '../../query/tasks';

const HEALTH_PRIORITY: Record<Project['operating']['health'], number> = {
  attention: 0,
  healthy: 1,
  idle: 2,
  empty: 3,
};

const TERMINAL_PROJECT_STATUSES = new Set(['completed', 'cancelled', 'archived']);

export function sortProjectPortfolio(projects: Project[]): Project[] {
  return [...projects].sort((left, right) => {
    const health = HEALTH_PRIORITY[left.operating.health] - HEALTH_PRIORITY[right.operating.health];
    if (health !== 0) return health;
    if (left.operating.counts.needsUser !== right.operating.counts.needsUser) {
      return right.operating.counts.needsUser - left.operating.counts.needsUser;
    }
    return right.operating.updatedAt - left.operating.updatedAt;
  });
}

export function projectPortfolioTotals(projects: Project[]): { needsUser: number; moving: number } {
  return projects.reduce((total, project) => ({
    needsUser: total.needsUser + project.operating.counts.needsUser,
    moving: total.moving + project.operating.counts.moving,
  }), { needsUser: 0, moving: 0 });
}

export function selectWorkOverviewProjects(projects: Project[], limit = 4): Project[] {
  return sortProjectPortfolio(projects)
    .filter((project) => !project.status || !TERMINAL_PROJECT_STATUSES.has(project.status))
    .slice(0, limit);
}

export function selectWorkOverviewTasks(tasks: TaskListItem[], limit = 4): TaskListItem[] {
  return tasks
    .filter((item) => item.task.phase !== 'closed')
    .slice(0, limit);
}

export function groupProjectTasks(tasks: ProjectTaskCard[]): {
  needsUser: ProjectTaskCard[];
  moving: ProjectTaskCard[];
  other: ProjectTaskCard[];
} {
  const needsUser = (task: ProjectTaskCard) => task.attention.some(
    (item) => item.kind === 'input_required' || item.kind === 'approval_required',
  );
  const moving = (task: ProjectTaskCard) => ['queued', 'running', 'verifying'].includes(task.operationalState);
  return {
    needsUser: tasks.filter(needsUser),
    moving: tasks.filter((task) => !needsUser(task) && moving(task)),
    other: tasks.filter((task) => !needsUser(task) && !moving(task)),
  };
}

export function formatProjectRelativeTime(timestamp: number, locale: string, now = Date.now()): string {
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return '';

  const deltaMs = timestamp - now;
  const minutes = Math.round(deltaMs / 60_000);
  const hours = Math.round(deltaMs / 3_600_000);
  const days = Math.round(deltaMs / 86_400_000);
  const [value, unit, fallbackSuffix] = Math.abs(minutes) < 60
    ? [minutes, 'minute', 'm'] as const
    : Math.abs(hours) < 24
      ? [hours, 'hour', 'h'] as const
      : [days, 'day', 'd'] as const;

  const intl = typeof Intl === 'object' ? Intl : undefined;
  const RelativeTimeFormat = intl?.RelativeTimeFormat;
  if (typeof RelativeTimeFormat === 'function') {
    try {
      return new RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' }).format(value, unit);
    } catch {
      // Some Hermes/system Intl builds reject otherwise valid locales. Keep the project list renderable.
    }
  }

  return `${Math.abs(value)}${fallbackSuffix}`;
}

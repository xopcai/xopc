import type { ProjectTaskCard } from '@xopcai/gateway-contract';

import type { Project } from '../../query/projects';

const HEALTH_PRIORITY: Record<Project['operating']['health'], number> = {
  attention: 0,
  healthy: 1,
  idle: 2,
  empty: 3,
};

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

export function groupProjectTasks(tasks: ProjectTaskCard[]): {
  needsUser: ProjectTaskCard[];
  moving: ProjectTaskCard[];
  other: ProjectTaskCard[];
} {
  return {
    needsUser: tasks.filter((task) => task.lane === 'needs_user'),
    moving: tasks.filter((task) => task.lane === 'moving'),
    other: tasks.filter((task) => task.lane !== 'needs_user' && task.lane !== 'moving'),
  };
}

export function formatProjectRelativeTime(timestamp: number, locale: string, now = Date.now()): string {
  const deltaMs = timestamp - now;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const minutes = Math.round(deltaMs / 60_000);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(deltaMs / 3_600_000);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(deltaMs / 86_400_000), 'day');
}

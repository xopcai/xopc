import type { ProjectTaskCard } from '@xopcai/gateway-contract';

const PHASE_RANK: Record<ProjectTaskCard['phase'], number> = {
  active: 0,
  review: 1,
  ready: 2,
  backlog: 3,
  closed: 4,
};

const OPERATIONAL_RANK: Record<ProjectTaskCard['operationalState'], number> = {
  blocked: 0,
  waiting: 1,
  verifying: 2,
  running: 3,
  queued: 4,
  idle: 5,
};

const PRIORITY_RANK: Record<ProjectTaskCard['priority'], number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Select the few tasks that are most useful for deciding what to do next. */
export function selectOverviewTasks(tasks: ProjectTaskCard[], limit = 4): ProjectTaskCard[] {
  return tasks
    .filter((task) => task.phase !== 'closed')
    .sort((left, right) => {
      const attentionDifference = Number(right.attention.length > 0) - Number(left.attention.length > 0);
      if (attentionDifference !== 0) return attentionDifference;
      const operationalDifference = OPERATIONAL_RANK[left.operationalState] - OPERATIONAL_RANK[right.operationalState];
      if (operationalDifference !== 0) return operationalDifference;
      const phaseDifference = PHASE_RANK[left.phase] - PHASE_RANK[right.phase];
      if (phaseDifference !== 0) return phaseDifference;
      const priorityDifference = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
      if (priorityDifference !== 0) return priorityDifference;
      return right.updatedAt - left.updatedAt;
    })
    .slice(0, limit);
}

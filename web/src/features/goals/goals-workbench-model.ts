export type GoalStatus = 'active' | 'paused' | 'blocked' | 'needs_input' | 'done' | 'archived';

export type GoalItem = {
  id: string;
  title: string;
  description?: string;
  status: GoalStatus;
  agentId: string;
  priority: 'low' | 'normal' | 'high';
  deadlineAt?: number;
  createdAt: number;
  updatedAt: number;
  turnsUsed: number;
  maxTurns: number;
  nextAction?: string;
  blockedReason?: string;
  activeSessionKey?: string;
  checklist: Array<{ id: string; text: string; status: 'pending' | 'completed' | 'impossible' }>;
  latestRun?: { verdict?: string; reason?: string; finishedAt?: number; startedAt: number };
};

export type GoalQueueItem = {
  id: string;
  goalId: string;
  status: 'queued' | 'running' | 'retry_waiting' | 'succeeded' | 'failed' | 'skipped';
  source: 'manual' | 'cron' | 'workflow' | 'api';
  userTurn?: { text?: string };
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  nextRunAt?: number;
  attempts: number;
  maxRetries: number;
  sessionKey?: string;
  error?: string;
};

export type WorkbenchSectionId = 'attention' | 'running' | 'ready' | 'later';

export const GOAL_STATUSES: GoalStatus[] = ['active', 'paused', 'blocked', 'needs_input', 'done', 'archived'];
export const WORKBENCH_SECTIONS: WorkbenchSectionId[] = ['attention', 'running', 'ready', 'later'];

export function goalProgress(goal: GoalItem): { done: number; total: number } {
  const total = goal.checklist.length;
  const done = goal.checklist.filter((item) => item.status === 'completed' || item.status === 'impossible').length;
  return { done, total };
}

export function queueTime(item: GoalQueueItem): number {
  return item.nextRunAt ?? item.finishedAt ?? item.startedAt ?? item.enqueuedAt;
}

export function latestQueueForGoals(queue: GoalQueueItem[]): Map<string, GoalQueueItem> {
  const byGoal = new Map<string, GoalQueueItem>();
  for (const item of queue) {
    const current = byGoal.get(item.goalId);
    if (!current || queueTime(item) > queueTime(current)) byGoal.set(item.goalId, item);
  }
  return byGoal;
}

export function isLiveQueueStatus(status: GoalQueueItem['status']): boolean {
  return status === 'running' || status === 'queued' || status === 'retry_waiting';
}

export function workbenchSectionForGoal(goal: GoalItem, queueItem?: GoalQueueItem): WorkbenchSectionId | null {
  if (goal.status === 'done' || goal.status === 'archived') return null;
  if (goal.status === 'blocked' || goal.status === 'needs_input' || queueItem?.status === 'failed') return 'attention';
  if (queueItem && isLiveQueueStatus(queueItem.status)) return 'running';
  if (goal.status === 'active') return 'ready';
  if (goal.status === 'paused') return 'later';
  return null;
}

function priorityRank(priority: GoalItem['priority']): number {
  if (priority === 'high') return 3;
  if (priority === 'normal') return 2;
  return 1;
}

export function compareOperationalGoals(
  a: GoalItem,
  b: GoalItem,
  queueByGoal: Map<string, GoalQueueItem>,
): number {
  const aQueue = queueByGoal.get(a.id);
  const bQueue = queueByGoal.get(b.id);
  const aLive = aQueue && isLiveQueueStatus(aQueue.status) ? 1 : 0;
  const bLive = bQueue && isLiveQueueStatus(bQueue.status) ? 1 : 0;
  if (aLive !== bLive) return bLive - aLive;
  const priorityDiff = priorityRank(b.priority) - priorityRank(a.priority);
  if (priorityDiff !== 0) return priorityDiff;
  const aDeadline = a.deadlineAt ?? Number.POSITIVE_INFINITY;
  const bDeadline = b.deadlineAt ?? Number.POSITIVE_INFINITY;
  if (aDeadline !== bDeadline) return aDeadline - bDeadline;
  return b.updatedAt - a.updatedAt;
}

export function matchesGoalSearch(goal: GoalItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    goal.title,
    goal.description,
    goal.nextAction,
    goal.blockedReason,
    goal.latestRun?.reason,
    goal.agentId,
    ...goal.checklist.map((item) => item.text),
  ].filter(Boolean).join('\n').toLowerCase().includes(normalized);
}

export function actionableCounts(goals: GoalItem[], queueByGoal: Map<string, GoalQueueItem>) {
  const counts = { attention: 0, running: 0, ready: 0, later: 0, history: 0 };
  for (const goal of goals) {
    if (goal.status === 'done' || goal.status === 'archived') {
      counts.history += 1;
      continue;
    }
    const section = workbenchSectionForGoal(goal, queueByGoal.get(goal.id));
    if (section) counts[section] += 1;
  }
  return counts;
}


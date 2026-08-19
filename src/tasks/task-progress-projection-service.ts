import type { TaskAttention, TaskProgress } from '@xopcai/gateway-contract';

import { getSessionTaskPlan } from '../storage/sqlite/session-task-plan-repository.js';
import type { TaskAggregate } from './task-repository.js';

export interface TaskProgressProjection {
  progress?: TaskProgress;
  attention?: TaskAttention;
}

export class TaskProgressProjectionService {
  project(task: TaskAggregate): TaskProgressProjection {
    const sessionKey = task.execution.activeSessionKey;
    const plan = sessionKey ? getSessionTaskPlan(sessionKey) : undefined;
    const progress = plan?.items.length ? {
      completed: plan.items.filter((item) => item.status === 'completed').length,
      total: plan.items.length,
      currentStep: plan.items.find((item) => item.status === 'in_progress')?.content
        ?? plan.items.find((item) => item.status === 'pending')?.content,
      items: plan.items.map((item) => ({ id: item.id, title: item.content, status: item.status })),
      updatedAt: plan.updatedAt,
    } : undefined;

    const required = task.contract?.approvalRequired ?? [];
    const approved = new Set(task.execution.approvedBoundaries);
    const missingApproval = required.find((boundary) => !approved.has(boundary));
    let attention: TaskAttention | undefined;
    if (task.status === 'needs_user') {
      attention = missingApproval
        ? { kind: 'approval', summary: task.execution.blockedReason ?? missingApproval }
        : { kind: 'input', summary: task.execution.blockedReason ?? task.execution.nextAction ?? 'User input is required' };
    } else if (task.status === 'blocked') {
      attention = {
        kind: 'dependency',
        summary: task.execution.blockedReason ?? task.execution.nextAction ?? 'A dependency is blocking progress',
      };
    }

    return {
      ...(progress ? { progress } : {}),
      ...(attention ? { attention } : {}),
    };
  }
}

import type { TaskPriority } from '@xopcai/gateway-contract';

import type { MediaRef } from '../media/types.js';

import {
  TaskRepository,
  type TaskExecutionSource,
  type TaskRuntime,
  type TaskUiLocale,
} from './task-repository.js';

export interface CreateTaskExecutionInput {
  objective: string;
  requestId?: string;
  expectedOutputs?: string[];
  acceptanceCriteria?: string[];
  constraints?: string[];
  approvalRequired?: string[];
  assumptions?: string[];
  risks?: string[];
  projectId?: string;
  sessionKey?: string;
  agentId?: string;
  priority?: TaskPriority;
  deadlineAt?: number;
  uiLocale?: TaskUiLocale;
  source?: TaskExecutionSource;
  contextText?: string;
  contextAttachments?: MediaRef[];
}

export interface TaskExecution {
  taskId: string;
  contractVersion: number;
  execution: TaskRuntime;
}

export class TaskExecutionService {
  readonly #tasks = new TaskRepository();

  create(input: CreateTaskExecutionInput): TaskExecution {
    const objective = input.objective.trim();
    if (!objective) throw new Error('Objective is required');
    const task = this.#tasks.create({
      objective,
      expectedOutputs: input.expectedOutputs?.length ? input.expectedOutputs : [objective],
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      constraints: input.constraints ?? [],
      approvalRequired: input.approvalRequired ?? [],
      assumptions: input.assumptions ?? [],
      risks: input.risks ?? [],
      priority: input.priority,
      dueAt: input.deadlineAt,
      createdBy: 'user',
      requestId: input.requestId,
      projectId: input.projectId,
      activeSessionKey: input.sessionKey,
      agentId: input.agentId ?? 'main',
      uiLocale: input.uiLocale,
      source: input.source,
      contextText: input.contextText,
      contextAttachments: input.contextAttachments,
      links: [
        ...(input.projectId
          ? [{ kind: 'project' as const, id: input.projectId, relation: 'contains' }]
          : []),
        ...(input.sessionKey
          ? [{ kind: 'session' as const, id: input.sessionKey, relation: 'originated_from' }]
          : []),
      ],
    });
    return {
      taskId: task.id,
      contractVersion: task.latestContractVersion,
      execution: task.execution,
    };
  }
}

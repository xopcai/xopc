import type {
  Task,
  TaskCreateRequest,
  TaskCreateResponse,
} from '@xopcai/gateway-contract';

import type { Config } from '../../config/schema.js';
import type { ProjectService } from '../../projects/project-service.js';
import { resolveProjectAgentId } from '../../projects/project-agent.js';
import { TaskCommandService } from '../../tasks/task-command-service.js';
import { defineTaskContract } from '../../tasks/task-contract-definition.js';
import { TaskDependencyService } from '../../tasks/task-dependency-service.js';
import { TaskExecutionService } from '../../tasks/task-execution-service.js';
import type { EnqueueTaskOptions, TaskQueueItem } from '../../tasks/task-queue.js';
import { TaskRepository } from '../../tasks/task-repository.js';

export interface TaskCreateDependencies {
  getConfig: () => Config;
  projects: ProjectService;
  enqueueTask: (taskId: string, options?: EnqueueTaskOptions) => TaskQueueItem;
}

export class TaskCreateService {
  readonly #tasks = new TaskRepository();
  readonly #dependencies = new TaskDependencyService();
  readonly #execution = new TaskExecutionService();
  readonly #inflight = new Map<string, Promise<TaskCreateResponse>>();

  constructor(private readonly deps: TaskCreateDependencies) {}

  async create(input: TaskCreateRequest): Promise<TaskCreateResponse> {
    const inflight = this.#inflight.get(input.requestId);
    if (inflight) return inflight;
    const pending = this.createOnce(input);
    this.#inflight.set(input.requestId, pending);
    try {
      return await pending;
    } finally {
      if (this.#inflight.get(input.requestId) === pending) this.#inflight.delete(input.requestId);
    }
  }

  private async createOnce(input: TaskCreateRequest): Promise<TaskCreateResponse> {
    const objective = input.objective.trim();
    const existingTask = this.#tasks.getByRequestId(input.requestId);
    const existingExecution = existingTask?.execution;
    if (existingTask) {
      const previous = existingTask.execution;
      if (
        existingTask.objective !== objective
        || previous.projectId !== input.projectId
        || (input.agentId !== undefined && previous.agentId !== input.agentId)
        || previous.uiLocale !== input.locale
        || existingTask.priority !== (input.priority ?? 'normal')
        || existingTask.dueAt !== input.dueAt
        || this.#dependencies.listDependencies(existingTask.id).map((item) => item.id).sort().join('\n')
          !== [...new Set(input.dependsOnTaskIds)].sort().join('\n')
      ) {
        throw new Error('requestId was already used for a different task');
      }
    }
    if (!existingTask && input.projectId && !this.deps.projects.get(input.projectId)) {
      throw new Error('Project not found');
    }

    const agentId = existingExecution?.agentId ?? resolveProjectAgentId({
      config: this.deps.getConfig(),
      projects: this.deps.projects,
      explicitAgentId: input.agentId,
      projectId: input.projectId,
    });

    if (input.mode === 'capture') {
      const task = existingTask ?? this.createTask({ ...input, objective, agentId });
      return { ok: true, mode: 'capture', task };
    }

    const task = existingTask ?? this.createTask({ ...input, objective, agentId });
    if (task.status !== 'pending') {
      return { ok: true, mode: 'start', task, activation: { status: 'already_started' } };
    }
    const activation = new TaskCommandService(this.deps.enqueueTask).execute({
      taskId: task.id,
      action: 'run',
      expectedUpdatedAt: task.updatedAt,
    });
    if (activation.ok === true) {
      return {
        ok: true,
        mode: 'start',
        task: activation.task,
        activation: activation.queued
          ? { status: 'queued', queueId: activation.queued.id }
          : activation.waitingOn
            ? { status: 'waiting_dependency', dependencies: activation.waitingOn }
            : { status: 'already_started' },
      };
    }
    if (activation.reason === 'approval_required') {
      return {
        ok: true,
        mode: 'start',
        task: activation.latest,
        activation: {
          status: 'needs_approval',
          requiredBoundaries: activation.requiredBoundaries,
        },
      };
    }
    if (activation.reason === 'conflict' || activation.reason === 'invalid_transition') {
      return {
        ok: true,
        mode: 'start',
        task: activation.latest,
        activation: { status: 'already_started' },
      };
    }
    throw new Error('Task could not be activated');
  }

  private createTask(input: TaskCreateRequest & {
    objective: string;
    agentId: string;
  }): Task {
    const contract = defineTaskContract(input.objective);
    const created = this.#execution.create({
      ...contract,
      requestId: input.requestId,
      projectId: input.projectId,
      agentId: input.agentId,
      priority: input.priority,
      deadlineAt: input.dueAt,
      uiLocale: input.locale,
      source: 'api',
    });
    const task = this.#tasks.get(created.taskId)!;
    return this.#dependencies.replace({
      taskId: task.id,
      dependsOnTaskIds: input.dependsOnTaskIds,
      expectedUpdatedAt: task.updatedAt,
    });
  }
}

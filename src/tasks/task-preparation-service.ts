import type { Config } from '../config/schema.js';
import type { ProjectService } from '../projects/project-service.js';
import { getRelationshipSettings } from '../storage/sqlite/index.js';
import { createLogger } from '../utils/logger.js';
import {
  ModelTaskContractPlanner,
  type TaskContractPlanner,
} from './task-contract-planner.js';
import { TaskRepository } from './task-repository.js';

const log = createLogger('TaskPreparation');

export class TaskPreparationService {
  readonly #tasks = new TaskRepository();
  readonly #planner: TaskContractPlanner;

  constructor(private readonly deps: {
    getConfig: () => Config;
    projects: ProjectService;
    planner?: TaskContractPlanner;
  }) {
    this.#planner = deps.planner ?? new ModelTaskContractPlanner(deps.getConfig);
  }

  async prepare(taskId: string): Promise<void> {
    const task = this.#tasks.get(taskId);
    if (!task || !['pending', 'planning'].includes(task.status)) return;
    if (task.latestContractVersion > 1) return;

    if (task.status === 'pending') {
      this.#tasks.update(task.id, { status: 'planning' });
    }
    try {
      const projectId = task.execution.projectId;
      const project = projectId ? this.deps.projects.get(projectId) : undefined;
      const relationship = getRelationshipSettings();
      const contract = await this.#planner.plan({
        objective: task.objective,
        taskContext: task.execution.contextMessage?.text,
        projectContext: project ? JSON.stringify({
          name: project.name,
          description: project.description,
          brief: project.brief,
          instructions: project.instructions,
        }) : undefined,
        userContext: JSON.stringify({
          supportMode: relationship.supportMode,
          proactiveEnabled: relationship.proactiveEnabled,
          allowedTopics: relationship.allowedTopics,
          blockedTopics: relationship.blockedTopics,
        }),
      });
      this.#tasks.reviseContract({
        taskId: task.id,
        ...contract,
        createdBy: 'system',
      });
      this.#tasks.update(task.id, {
        nextAction: contract.acceptanceCriteria[0] ?? contract.expectedOutputs[0] ?? null,
      });
    } catch (error) {
      log.warn({ err: error, taskId: task.id }, 'Task planning kept the initial contract');
    }
  }
}

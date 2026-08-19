import type { ProjectOperatingView } from '@xopcai/gateway-contract';

import {
  buildProjectLoopOverview,
  type ProjectService,
} from '../projects/index.js';
import { TaskReceiptService } from './task-receipt-service.js';
import { TaskProgressProjectionService } from './task-progress-projection-service.js';
import { ProjectMonitoringService } from './project-monitoring-service.js';
import { compareProjectTaskCards, projectTaskCard } from './task-board.js';
import { TaskDependencyService } from './task-dependency-service.js';
import { TaskRepository } from './task-repository.js';
import type { TaskQueueItem } from './task-queue.js';

export class ProjectOperatingViewService {
  readonly #tasks = new TaskRepository();
  readonly #receipts = new TaskReceiptService();
  readonly #monitoring = new ProjectMonitoringService();
  readonly #progress = new TaskProgressProjectionService();
  readonly #dependencies = new TaskDependencyService();

  constructor(
    private readonly projects: ProjectService,
    private readonly queueSnapshot: () => TaskQueueItem[] = () => [],
  ) {}

  get(projectId: string): ProjectOperatingView | undefined {
    const project = this.projects.getWithDetails(projectId);
    if (!project) return undefined;
    const projectTasks = this.#tasks.listByProject(project.id, 200);
    const tasks = projectTasks.map((task) => {
      const execution = task.execution;
      return {
        id: task.id,
        objective: task.objective,
        status: task.status,
        priority: execution.priority,
        nextAction: execution.nextAction,
        blockedReason: execution.blockedReason,
        updatedAt: task.updatedAt,
      };
    });
    const loop = buildProjectLoopOverview({
      project,
      tasks,
      recentWorkflowRuns: project.recentWorkflowRuns,
    });
    const recentReceipts = this.#receipts.list({ projectId: project.id, limit: 100 });
    const nextChecks = new Map<string, number>();
    for (const item of this.queueSnapshot()) {
      if (item.status !== 'scheduled' || item.nextRunAt === undefined) continue;
      const current = nextChecks.get(item.taskId);
      if (current === undefined || item.nextRunAt < current) nextChecks.set(item.taskId, item.nextRunAt);
    }
    const latestVerification = new Map<string, 'passed' | 'failed' | 'unverified'>();
    for (const receipt of recentReceipts) {
      if (receipt.taskId && !latestVerification.has(receipt.taskId)) {
        latestVerification.set(receipt.taskId, receipt.verification.status);
      }
    }
    return {
      project,
      tasks: projectTasks
        .flatMap((task) => {
          const card = projectTaskCard(task);
          if (!card) return [];
          const verification = latestVerification.get(task.id);
          const nextCheckAt = nextChecks.get(task.id);
          return [{
            ...card,
            blockedBy: this.#dependencies.listBlocking(task.id),
            ...this.#progress.project(task),
            ...(nextCheckAt === undefined ? {} : { nextCheckAt }),
            ...(verification ? { latestVerification: verification } : {}),
          }];
        })
        .sort(compareProjectTaskCards),
      blockers: loop.attentionItems,
      running: project.recentWorkflowRuns.filter((run) => run.status === 'queued' || run.status === 'running'),
      recentReceipts: recentReceipts.slice(0, 10),
      digest: {
        health: loop.digest.status,
        summary: loop.digest.summary,
        recommendedAction: loop.recommendedAction,
      },
      monitoring: this.#monitoring.get(project.id),
    };
  }
}

import type {
  ProjectOperatingSummary,
  ProjectOperatingView,
  ProjectTaskCard,
} from '@xopcai/gateway-contract';

import type { ProjectService } from '../projects/index.js';
import { ProjectMonitoringService } from './project-monitoring-service.js';
import { TaskDependencyService } from './task-dependency-service.js';
import { TaskReadModelProjector } from './task-read-model-projector.js';
import { TaskRepository } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';

export function summarizeProjectOperatingView(view: ProjectOperatingView): ProjectOperatingSummary {
  const counts = {
    ready: 0,
    moving: 0,
    waiting: 0,
    needsUser: 0,
    done: 0,
  };
  for (const task of view.tasks) {
    if (task.attention.some((item) => item.kind === 'input_required' || item.kind === 'approval_required')) {
      counts.needsUser += 1;
      continue;
    }
    if (task.phase === 'closed') counts.done += 1;
    else if (['queued', 'running', 'verifying'].includes(task.operationalState)) counts.moving += 1;
    else if (task.operationalState === 'waiting' || task.operationalState === 'blocked') counts.waiting += 1;
    else counts.ready += 1;
  }
  return {
    ...view.digest,
    counts,
    updatedAt: Math.max(view.project.updatedAt, ...view.tasks.map((task) => task.updatedAt)),
  };
}

export class ProjectOperatingViewService {
  readonly #tasks = new TaskRepository();
  readonly #runs = new TaskRunRepository();
  readonly #monitoring = new ProjectMonitoringService();
  readonly #projector = new TaskReadModelProjector();
  readonly #dependencies = new TaskDependencyService();

  constructor(private readonly projects: ProjectService) {}

  get(projectId: string): ProjectOperatingView | undefined {
    const project = this.projects.getWithDetails(projectId);
    if (!project) return undefined;
    const projectTasks = this.#tasks.listByProject(project.id, 200);
    const cards = projectTasks.map((task): ProjectTaskCard => {
      const model = this.#projector.project(task);
      const latest = this.#runs.getLatestRoot(task.id);
      const receipt = latest ? this.#runs.getReceipt(latest.id) : undefined;
      const base = {
        id: task.id,
        title: task.title,
        phase: task.phase,
        ...(task.resolution ? { resolution: task.resolution } : {}),
        operationalState: model.operationalState,
        priority: task.priority,
        ...(task.dueAt === undefined ? {} : { dueAt: task.dueAt }),
        acceptanceCriteriaCount: task.contract?.acceptanceCriteria.length ?? 0,
        attention: model.attention,
        blockedBy: this.#dependencies.listBlocking(task.id),
        allowedCommands: model.allowedCommands,
        ...(receipt ? { latestVerification: receipt.verification.status } : {}),
        updatedAt: task.updatedAt,
      };
      return base;
    });
    const recentResults = projectTasks
      .flatMap((task) => this.#runs.listReceipts(task.id, 10).map((receipt) => ({
        taskId: task.id,
        taskTitle: task.title,
        receipt,
      })))
      .sort((a, b) => b.receipt.finalizedAt - a.receipt.finalizedAt)
      .slice(0, 10);
    const needsUser = (card: ProjectTaskCard) => card.attention.some(
      (item) => item.kind === 'input_required' || item.kind === 'approval_required',
    );
    const moving = (card: ProjectTaskCard) => ['queued', 'running', 'verifying'].includes(card.operationalState);
    const attentionCount = cards.filter((card) => card.attention.length > 0).length;
    return {
      project,
      tasks: cards,
      dependencyEdges: this.#dependencies.listProjectEdges(project.id),
      blockers: cards.flatMap((card) => card.attention.map((item) => ({
        id: item.sourceId ?? `${card.id}:${item.kind}`,
        taskId: card.id,
        kind: item.kind,
        title: card.title,
        detail: item.summary,
        href: `/tasks/${encodeURIComponent(card.id)}`,
        updatedAt: card.updatedAt,
      }))),
      running: project.recentWorkflowRuns.filter((run) => run.status === 'queued' || run.status === 'running'),
      recentResults,
      digest: {
        health: cards.length === 0 ? 'empty' : attentionCount > 0 ? 'attention' : 'healthy',
        summary: cards.length === 0
          ? 'No tasks yet'
          : `${cards.filter(moving).length} moving, ${attentionCount} need attention`,
        recommendedAction: cards.find(needsUser)?.attention[0]?.summary
          ?? cards.find((card) => card.attention.length > 0)?.attention[0]?.summary
          ?? cards.find(moving)?.title
          ?? cards.find((card) => card.phase === 'ready')?.title
          ?? cards.find((card) => card.phase === 'backlog')?.title,
      },
      monitoring: this.#monitoring.get(project.id),
    };
  }
}

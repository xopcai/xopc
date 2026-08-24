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

export function projectTaskLane(
  card: Pick<ProjectTaskCard, 'phase' | 'operationalState' | 'attention'>,
): ProjectTaskCard['lane'] {
  if (card.phase === 'closed') return 'done';
  if (card.attention.some((item) => item.kind === 'input_required' || item.kind === 'approval_required')) {
    return 'needs_user';
  }
  if (['queued', 'running', 'verifying'].includes(card.operationalState)) return 'moving';
  if (card.operationalState === 'waiting' || card.operationalState === 'blocked') return 'waiting';
  return 'ready';
}

export function summarizeProjectOperatingView(view: ProjectOperatingView): ProjectOperatingSummary {
  const counts = {
    ready: 0,
    moving: 0,
    waiting: 0,
    needsUser: 0,
    done: 0,
  };
  for (const task of view.tasks) {
    if (task.lane === 'needs_user') counts.needsUser += 1;
    else counts[task.lane] += 1;
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
      return { ...base, lane: projectTaskLane(base) };
    });
    const recentResults = projectTasks
      .flatMap((task) => this.#runs.listReceipts(task.id, 10).map((receipt) => ({
        taskId: task.id,
        taskTitle: task.title,
        receipt,
      })))
      .sort((a, b) => b.receipt.finalizedAt - a.receipt.finalizedAt)
      .slice(0, 10);
    const attentionCount = cards.filter((card) => card.lane === 'needs_user').length;
    return {
      project,
      tasks: cards.sort((a, b) => b.updatedAt - a.updatedAt),
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
          : `${cards.filter((card) => card.lane === 'moving').length} moving, ${attentionCount} need attention`,
        recommendedAction: cards.find((card) => card.lane === 'needs_user')?.attention[0]?.summary
          ?? cards.find((card) => card.lane === 'moving')?.title
          ?? cards.find((card) => card.lane === 'ready')?.title,
      },
      monitoring: this.#monitoring.get(project.id),
    };
  }
}

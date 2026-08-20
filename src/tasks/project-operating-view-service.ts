import type { ProjectOperatingView, ProjectTaskCard } from '@xopcai/gateway-contract';

import type { ProjectService } from '../projects/index.js';
import { ProjectMonitoringService } from './project-monitoring-service.js';
import { TaskDependencyService } from './task-dependency-service.js';
import { TaskReadModelProjector } from './task-read-model-projector.js';
import { TaskRepository } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';

function lane(card: Pick<ProjectTaskCard, 'phase' | 'operationalState'>): ProjectTaskCard['lane'] {
  if (card.phase === 'closed') return 'done';
  if (card.operationalState === 'waiting' || card.operationalState === 'blocked') return 'needs_user';
  if (['queued', 'running', 'verifying'].includes(card.operationalState)) return 'moving';
  return 'ready';
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
      return { ...base, lane: lane(base) };
    });
    const recentReceipts = projectTasks
      .flatMap((task) => this.#runs.listReceipts(task.id, 10))
      .sort((a, b) => b.finalizedAt - a.finalizedAt)
      .slice(0, 10);
    const attentionCount = cards.filter((card) => card.lane === 'needs_user').length;
    return {
      project,
      tasks: cards.sort((a, b) => b.updatedAt - a.updatedAt),
      blockers: cards.flatMap((card) => card.attention.map((item) => ({
        id: item.sourceId ?? `${card.id}:${item.kind}`,
        kind: item.kind,
        title: card.title,
        detail: item.summary,
        updatedAt: card.updatedAt,
      }))),
      running: project.recentWorkflowRuns.filter((run) => run.status === 'queued' || run.status === 'running'),
      recentReceipts,
      digest: {
        health: cards.length === 0 ? 'empty' : attentionCount > 0 ? 'attention' : 'healthy',
        summary: cards.length === 0
          ? 'No tasks yet'
          : `${cards.filter((card) => card.lane === 'moving').length} moving, ${attentionCount} need attention`,
      },
      monitoring: this.#monitoring.get(project.id),
    };
  }
}

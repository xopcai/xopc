import type { ProjectOperatingView } from '@xopcai/gateway-contract';

import { GoalService, type GoalWithDetails } from '../goals/index.js';
import {
  buildProjectLoopOverview,
  type ProjectService,
} from '../projects/index.js';
import type { WorkItemService } from '../work-items/index.js';
import { OutcomeReceiptService } from './outcome-receipt-service.js';
import { ProjectMonitoringService } from './project-monitoring-service.js';

export class ProjectOperatingViewService {
  readonly #goals = new GoalService();
  readonly #receipts = new OutcomeReceiptService();
  readonly #monitoring = new ProjectMonitoringService();

  constructor(
    private readonly projects: ProjectService,
    private readonly workItems: WorkItemService,
  ) {}

  get(projectId: string): ProjectOperatingView | undefined {
    const project = this.projects.getWithDetails(projectId);
    if (!project) return undefined;
    const goals = this.projects.listGoalIds(project.id, 100)
      .map((goalId) => this.#goals.get(goalId))
      .filter((goal): goal is GoalWithDetails => Boolean(goal));
    const actions = this.workItems.listProjectWorkItems(project.id, { limit: 100 }).items
      .filter((item) => item.status !== 'done' && item.status !== 'cancelled');
    const loop = buildProjectLoopOverview({
      project,
      goals,
      recentWorkflowRuns: project.recentWorkflowRuns,
    });
    return {
      project,
      desiredOutcomes: goals.filter((goal) => !goal.archivedAt),
      currentActions: actions,
      blockers: loop.attentionItems,
      running: project.recentWorkflowRuns.filter((run) => run.status === 'queued' || run.status === 'running'),
      recentReceipts: this.#receipts.list({ projectId: project.id, limit: 10 }),
      digest: {
        health: loop.digest.status,
        summary: loop.digest.summary,
        recommendedAction: loop.recommendedAction,
      },
      monitoring: this.#monitoring.get(project.id),
    };
  }
}

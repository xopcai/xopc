import type { ProjectOperatingView } from '@xopcai/gateway-contract';

import {
  buildProjectLoopOverview,
  type ProjectService,
} from '../projects/index.js';
import type { WorkItemService } from '../work-items/index.js';
import { OutcomeReceiptService } from './outcome-receipt-service.js';
import { ProjectMonitoringService } from './project-monitoring-service.js';
import { OutcomeExecutionStateRepository } from './outcome-execution-state.js';
import { OutcomeRepository } from './outcome-repository.js';

export class ProjectOperatingViewService {
  readonly #outcomes = new OutcomeRepository();
  readonly #executions = new OutcomeExecutionStateRepository();
  readonly #receipts = new OutcomeReceiptService();
  readonly #monitoring = new ProjectMonitoringService();

  constructor(
    private readonly projects: ProjectService,
    private readonly workItems: WorkItemService,
  ) {}

  get(projectId: string): ProjectOperatingView | undefined {
    const project = this.projects.getWithDetails(projectId);
    if (!project) return undefined;
    const outcomes = this.#executions.listByProject(project.id, 100).flatMap((execution) => {
      const outcome = this.#outcomes.get(execution.outcomeId);
      if (!outcome) return [];
      return [{
        id: outcome.id,
        objective: outcome.objective,
        status: outcome.internalStatus,
        priority: execution.priority,
        description: execution.description,
        nextAction: execution.nextAction,
        blockedReason: execution.blockedReason,
        updatedAt: Math.max(outcome.updatedAt, execution.updatedAt),
      }];
    });
    const actions = this.workItems.listProjectWorkItems(project.id, { limit: 100 }).items
      .filter((item) => item.status !== 'done' && item.status !== 'cancelled');
    const loop = buildProjectLoopOverview({
      project,
      outcomes,
      recentWorkflowRuns: project.recentWorkflowRuns,
    });
    return {
      project,
      desiredOutcomes: outcomes.map((outcome) => ({
        id: outcome.id,
        title: outcome.objective,
        status: outcome.status,
        nextAction: outcome.nextAction,
        blockedReason: outcome.blockedReason,
        updatedAt: outcome.updatedAt,
      })),
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

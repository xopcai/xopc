import { createHash, randomUUID } from 'node:crypto';

import type {
  ConfirmedWork,
  MonitoringMode,
  WorkExecutionMode,
  WorkIntakeProposal,
} from '@xopcai/gateway-contract';

import {
  GoalService,
  type EnqueueGoalRunOptions,
  type GoalQueueItemSnapshot,
} from '../goals/index.js';
import { ProjectService, type Project } from '../projects/index.js';
import {
  getRelationshipSettings,
  getSessionMetadata,
  runSqliteWriteTransaction,
} from '../storage/sqlite/index.js';
import { WorkItemService } from '../work-items/index.js';
import { createLogger } from '../utils/logger.js';
import { ProjectMonitoringService } from './project-monitoring-service.js';
import {
  WorkIntakeRepository,
  type StoredWorkIntake,
} from './work-intake-repository.js';

const INTAKE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_NEXT_ACTION = 'Clarify the scope and complete the first verifiable step.';
const log = createLogger('WorkIntake');

function compactTitle(value: string): string {
  const firstLine = value.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const firstSentence = firstLine.split(/[.!?。！？]/, 1)[0]?.trim() ?? firstLine;
  return (firstSentence || 'New work').slice(0, 80);
}

function projectScore(project: Project, objective: string): number {
  const query = objective.toLocaleLowerCase();
  const name = project.name.toLocaleLowerCase();
  let score = query.includes(name) ? 10 : 0;
  const tokens = name.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 2);
  score += tokens.filter((token) => query.includes(token)).length * 2;
  if (project.description && query.includes(project.description.toLocaleLowerCase())) score += 2;
  return score;
}

function requestFingerprint(input: {
  objective: string;
  projectId?: string;
  sessionKey?: string;
  agentId?: string;
  monitoringMode?: MonitoringMode;
}): string {
  return createHash('sha256').update(JSON.stringify({
    objective: input.objective.trim(),
    projectId: input.projectId ?? null,
    sessionKey: input.sessionKey ?? null,
    agentId: input.agentId ?? null,
    monitoringMode: input.monitoringMode ?? null,
  })).digest('hex');
}

export interface WorkIntakeExecutionPort {
  enqueue(goalId: string, options: EnqueueGoalRunOptions): GoalQueueItemSnapshot;
}

export class WorkIntakeService {
  readonly #goals = new GoalService();
  readonly #monitoring = new ProjectMonitoringService();
  readonly #repository = new WorkIntakeRepository();

  constructor(
    private readonly projects: ProjectService,
    private readonly workItems: WorkItemService,
    private readonly execution?: WorkIntakeExecutionPort,
  ) {}

  propose(input: {
    idempotencyKey: string;
    objective: string;
    projectId?: string;
    sessionKey?: string;
    agentId?: string;
    monitoringMode?: MonitoringMode;
  }): WorkIntakeProposal {
    const fingerprint = requestFingerprint(input);
    const existing = this.#repository.getByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new Error('Idempotency key was already used for a different work intake');
      }
      return existing.proposal;
    }
    const objective = input.objective.trim();
    if (!objective) throw new Error('Objective is required');
    const explicitProject = input.projectId ? this.projects.get(input.projectId) : undefined;
    if (input.projectId && !explicitProject) throw new Error('Project not found');
    const matches = this.projects.list({ status: 'active', limit: 200 }).items
      .map((project) => ({ project, score: projectScore(project, objective) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);
    const matchedProject = explicitProject ?? (matches[0]?.score >= 4 ? matches[0].project : undefined);
    const relationship = getRelationshipSettings();
    const id = randomUUID();
    const proposal: WorkIntakeProposal = {
      id,
      objective,
      classification: matchedProject ? 'existing_project' : 'new_project',
      suggestedProject: {
        id: matchedProject?.id,
        name: matchedProject?.name ?? compactTitle(objective),
        outcome: objective,
        nextAction: DEFAULT_NEXT_ACTION,
      },
      possibleProjectMatches: matches.map(({ project, score }) => ({ id: project.id, name: project.name, score })),
      monitoringSuggestion: {
        mode: input.monitoringMode ?? (relationship.proactiveEnabled ? 'ask_before_action' : 'observe'),
        scenarios: ['project_delivery_risk', 'blocked_work'],
      },
      planningContext: {
        supportMode: relationship.supportMode,
        proactiveEnabled: relationship.proactiveEnabled,
      },
      expiresAt: Date.now() + INTAKE_TTL_MS,
    };
    const stored = this.#repository.create({
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint,
      proposal,
      sessionKey: input.sessionKey,
      agentId: input.agentId,
    });
    if (stored.requestFingerprint !== fingerprint) {
      throw new Error('Idempotency key was already used for a different work intake');
    }
    return stored.proposal;
  }

  confirm(input: {
    proposalId: string;
    executionMode: WorkExecutionMode;
    projectId?: string;
    projectName?: string;
    nextAction?: string;
  }): ConfirmedWork | undefined {
    const intake = this.#repository.get(input.proposalId);
    if (!intake || intake.status === 'expired' || intake.status === 'cancelled') return undefined;
    const existing = this.#repository.toConfirmedWork(intake);
    if (existing) return this._ensureExecution(intake);
    const proposal = intake.proposal;
    runSqliteWriteTransaction(() => {
      const selectedProjectId = input.projectId ?? proposal.suggestedProject.id;
      const existingProject = selectedProjectId ? this.projects.get(selectedProjectId) : undefined;
      if (selectedProjectId && !existingProject) throw new Error('Project not found');
      const project = existingProject ?? this.projects.create({
        name: input.projectName?.trim() || proposal.suggestedProject.name,
        description: proposal.objective,
        brief: proposal.objective,
        defaultAgentId: intake.agentId,
      });
      const nextAction = input.nextAction?.trim() || proposal.suggestedProject.nextAction;
      const goal = this.#goals.create({
        title: proposal.suggestedProject.outcome,
        description: proposal.objective,
        projectId: project.id,
        sessionKey: intake.sessionKey,
        agentId: intake.agentId ?? project.defaultAgentId ?? 'main',
        source: 'api',
      });
      this.#goals.update(goal.id, { nextAction });
      const workItem = this.workItems.createProjectWorkItem(project.id, {
        title: proposal.suggestedProject.outcome,
        description: proposal.objective,
        status: 'todo',
        priority: 'normal',
        ownerAgentId: intake.agentId ?? project.defaultAgentId,
        nextAction,
      });
      this.workItems.addLink(workItem.id, {
        kind: 'goal',
        targetId: goal.id,
        title: goal.title,
        statusSnapshot: goal.status,
      }, 'goal_created');
      if (intake.sessionKey && getSessionMetadata(intake.sessionKey)) {
        this.projects.attachSession(intake.sessionKey, project.id);
      }
      this.#monitoring.configure({
        projectId: project.id,
        mode: proposal.monitoringSuggestion.mode,
        scenarios: proposal.monitoringSuggestion.scenarios,
      });
      this.#repository.markConfirmed({
        intakeId: proposal.id,
        executionMode: input.executionMode,
        projectId: project.id,
        goalId: goal.id,
        workItemId: workItem.id,
        sessionKey: intake.sessionKey,
      });
    });
    const confirmed = this.#repository.get(proposal.id);
    if (!confirmed) throw new Error('Failed to confirm work intake');
    return this._ensureExecution(confirmed);
  }

  reconcilePendingExecutions(): number {
    if (!this.execution) return 0;
    let reconciled = 0;
    for (const intake of this.#repository.listPendingExecution()) {
      const work = this._ensureExecution(intake);
      if (work.execution.queueId) reconciled += 1;
    }
    return reconciled;
  }

  private _ensureExecution(intake: StoredWorkIntake): ConfirmedWork {
    if (intake.status !== 'confirmed') throw new Error('Work intake is not confirmed');
    if (intake.executionMode === 'run_now' && !intake.queueId) {
      try {
        if (!this.execution || !intake.goalId || !intake.workItemId) {
          throw new Error('Work execution is unavailable');
        }
        const queued = this.execution.enqueue(intake.goalId, {
          source: 'api',
          executionContext: {
            workItemId: intake.workItemId,
            contextTraceId: intake.proposal.id,
            triggerKind: 'user',
          },
        });
        intake = this.#repository.setExecution({
          intakeId: intake.proposal.id,
          sessionKey: queued.sessionKey,
          queueId: queued.id,
        });
        const item = this.workItems.getWorkItem(intake.workItemId);
        if (item?.status === 'todo' || item?.status === 'backlog') {
          this.workItems.updateWorkItem(item.id, { status: 'in_progress' });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.warn({
          err,
          intakeId: intake.proposal.id,
          goalId: intake.goalId,
          workItemId: intake.workItemId,
        }, `Work intake was confirmed but execution could not be queued: ${errorMessage}`);
      }
    }
    const work = this.#repository.toConfirmedWork(intake);
    if (!work) throw new Error('Failed to resolve confirmed work intake');
    return work;
  }
}

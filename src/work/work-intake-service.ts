import { createHash, randomUUID } from 'node:crypto';

import type {
  ConfirmedWork,
  WorkExecutionMode,
  WorkIntakeProposal,
} from '@xopcai/gateway-contract';

import {
  GoalService,
  type EnqueueGoalRunOptions,
  type GoalQueueItemSnapshot,
} from '../goals/index.js';
import { ProjectService } from '../projects/index.js';
import {
  getRelationshipSettings,
  getSessionMetadata,
  runSqliteWriteTransaction,
} from '../storage/sqlite/index.js';
import { createLogger } from '../utils/logger.js';
import { OutcomeRepository } from './outcome-repository.js';
import { defineOutcomeContract } from './outcome-contract-definition.js';
import {
  WorkIntakeRepository,
  type StoredWorkIntake,
} from './work-intake-repository.js';

const INTAKE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_NEXT_ACTION = 'Complete the first verifiable result.';
const log = createLogger('WorkIntake');

function outcomeContractDraft(objective: string) {
  return defineOutcomeContract(objective);
}

function requestFingerprint(input: {
  objective: string;
  projectId?: string;
  sessionKey?: string;
  agentId?: string;
}): string {
  return createHash('sha256').update(JSON.stringify({
    objective: input.objective.trim(),
    projectId: input.projectId ?? null,
    sessionKey: input.sessionKey ?? null,
    agentId: input.agentId ?? null,
  })).digest('hex');
}

export interface WorkIntakeExecutionPort {
  enqueue(goalId: string, options: EnqueueGoalRunOptions): GoalQueueItemSnapshot;
}

export class WorkIntakeService {
  readonly #goals = new GoalService();
  readonly #outcomes = new OutcomeRepository();
  readonly #repository = new WorkIntakeRepository();

  constructor(
    private readonly projects: ProjectService,
    private readonly execution?: WorkIntakeExecutionPort,
  ) {}

  propose(input: {
    idempotencyKey: string;
    objective: string;
    projectId?: string;
    sessionKey?: string;
    agentId?: string;
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
    const relationship = getRelationshipSettings();
    const contract = outcomeContractDraft(objective);
    const id = randomUUID();
    const proposal: WorkIntakeProposal = {
      id,
      objective,
      ...(explicitProject ? { projectId: explicitProject.id } : {}),
      planningContext: {
        supportMode: relationship.supportMode,
        proactiveEnabled: relationship.proactiveEnabled,
      },
      outcomeContract: {
        objective: contract.objective,
        deliverables: contract.deliverables,
        acceptanceCriteria: contract.acceptanceCriteria,
        constraints: contract.constraints,
        approvalRequired: contract.approvalRequired,
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
  }): ConfirmedWork | undefined {
    const intake = this.#repository.get(input.proposalId);
    if (!intake || intake.status === 'expired' || intake.status === 'cancelled') return undefined;
    const existing = this.#repository.toConfirmedWork(intake);
    if (existing) return this._ensureExecution(intake);
    const proposal = intake.proposal;
    runSqliteWriteTransaction(() => {
      const selectedProjectId = input.projectId ?? proposal.projectId;
      const existingProject = selectedProjectId ? this.projects.get(selectedProjectId) : undefined;
      if (selectedProjectId && !existingProject) throw new Error('Project not found');
      const contract = proposal.outcomeContract;
      const outcome = this.#outcomes.create({
        objective: contract.objective,
        deliverables: contract.deliverables,
        acceptanceCriteria: contract.acceptanceCriteria,
        constraints: contract.constraints,
        approvalRequired: contract.approvalRequired,
        createdBy: 'user',
        links: [
          ...(existingProject
            ? [{ kind: 'project' as const, id: existingProject.id, relation: 'contains' }]
            : []),
          ...(intake.sessionKey
            ? [{ kind: 'session' as const, id: intake.sessionKey, relation: 'originated_from' }]
            : []),
        ],
      });
      const goal = this.#goals.create({
        outcomeId: outcome.id,
        outcomeContractVersion: outcome.latestContractVersion,
        title: contract.objective,
        description: proposal.objective,
        projectId: existingProject?.id,
        sessionKey: intake.sessionKey,
        agentId: intake.agentId ?? existingProject?.defaultAgentId ?? 'main',
        source: 'api',
      });
      this.#goals.update(goal.id, { nextAction: DEFAULT_NEXT_ACTION });
      this.#outcomes.addLink(outcome.id, { kind: 'goal', id: goal.id, relation: 'drives' });
      if (existingProject && intake.sessionKey && getSessionMetadata(intake.sessionKey)) {
        this.projects.attachSession(intake.sessionKey, existingProject.id);
      }
      this.#repository.markConfirmed({
        intakeId: proposal.id,
        executionMode: input.executionMode,
        projectId: existingProject?.id,
        goalId: goal.id,
        outcomeId: outcome.id,
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
        if (!this.execution || !intake.goalId || !intake.outcomeId) {
          throw new Error('Work execution is unavailable');
        }
        const queued = this.execution.enqueue(intake.goalId, {
          source: 'api',
          executionContext: {
            outcomeId: intake.outcomeId,
            contextTraceId: intake.proposal.id,
            triggerKind: 'user',
          },
        });
        intake = this.#repository.setExecution({
          intakeId: intake.proposal.id,
          sessionKey: queued.sessionKey,
          queueId: queued.id,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.warn({
          err,
          intakeId: intake.proposal.id,
          goalId: intake.goalId,
        }, `Work intake was confirmed but execution could not be queued: ${errorMessage}`);
      }
    }
    const work = this.#repository.toConfirmedWork(intake);
    if (!work) throw new Error('Failed to resolve confirmed work intake');
    return work;
  }
}

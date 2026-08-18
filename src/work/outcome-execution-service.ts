import { runSqliteWriteTransaction } from '../storage/sqlite/index.js';
import { OutcomeRepository } from './outcome-repository.js';
import {
  OutcomeExecutionStateRepository,
  type OutcomeExecutionPriority,
  type OutcomeExecutionSource,
  type OutcomeExecutionState,
  type OutcomeUiLocale,
} from './outcome-execution-state.js';

export interface CreateOutcomeExecutionInput {
  objective: string;
  description?: string;
  deliverables?: string[];
  acceptanceCriteria?: string[];
  constraints?: string[];
  approvalRequired?: string[];
  assumptions?: string[];
  risks?: string[];
  projectId?: string;
  sessionKey?: string;
  agentId?: string;
  priority?: OutcomeExecutionPriority;
  deadlineAt?: number;
  uiLocale?: OutcomeUiLocale;
  source?: OutcomeExecutionSource;
}

export interface OutcomeExecution {
  outcomeId: string;
  contractVersion: number;
  execution: OutcomeExecutionState;
}

export class OutcomeExecutionService {
  readonly #outcomes = new OutcomeRepository();
  readonly #executions = new OutcomeExecutionStateRepository();

  create(input: CreateOutcomeExecutionInput): OutcomeExecution {
    const objective = input.objective.trim();
    if (!objective) throw new Error('Objective is required');
    return runSqliteWriteTransaction(() => {
      const outcome = this.#outcomes.create({
        objective,
        deliverables: input.deliverables?.length ? input.deliverables : [objective],
        acceptanceCriteria: input.acceptanceCriteria ?? [],
        constraints: input.constraints ?? [],
        approvalRequired: input.approvalRequired ?? [],
        assumptions: input.assumptions ?? [],
        risks: input.risks ?? [],
        dueAt: input.deadlineAt,
        createdBy: 'user',
        links: [
          ...(input.projectId
            ? [{ kind: 'project' as const, id: input.projectId, relation: 'contains' }]
            : []),
          ...(input.sessionKey
            ? [{ kind: 'session' as const, id: input.sessionKey, relation: 'originated_from' }]
            : []),
        ],
      });
      const execution = this.#executions.create({
        outcomeId: outcome.id,
        description: input.description,
        projectId: input.projectId,
        activeSessionKey: input.sessionKey,
        agentId: input.agentId ?? 'main',
        priority: input.priority,
        uiLocale: input.uiLocale,
        source: input.source,
      });
      return {
        outcomeId: outcome.id,
        contractVersion: outcome.latestContractVersion,
        execution,
      };
    });
  }
}

import { runSqliteWriteTransaction } from '../storage/sqlite/index.js';
import {
  GoalService,
  type Goal,
  type GoalPriority,
  type GoalSource,
  type GoalUiLocale,
} from '../goals/index.js';
import { OutcomeRepository } from './outcome-repository.js';

export interface CreateOutcomeExecutionInput {
  objective: string;
  description?: string;
  deliverables?: string[];
  acceptanceCriteria?: string[];
  constraints?: string[];
  approvalRequired?: string[];
  projectId?: string;
  sessionKey?: string;
  agentId?: string;
  priority?: GoalPriority;
  deadlineAt?: number;
  judgeModelRef?: string;
  maxTurns?: number;
  uiLocale?: GoalUiLocale;
  source?: GoalSource;
}

export interface OutcomeExecution {
  outcomeId: string;
  contractVersion: number;
  goal: Goal;
}

export class OutcomeExecutionService {
  readonly #goals = new GoalService();
  readonly #outcomes = new OutcomeRepository();

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
      const goal = this.#goals.create({
        outcomeId: outcome.id,
        outcomeContractVersion: outcome.latestContractVersion,
        title: objective,
        description: input.description,
        projectId: input.projectId,
        sessionKey: input.sessionKey,
        agentId: input.agentId ?? 'main',
        priority: input.priority,
        deadlineAt: input.deadlineAt,
        judgeModelRef: input.judgeModelRef,
        maxTurns: input.maxTurns,
        uiLocale: input.uiLocale,
        source: input.source,
      });
      this.#outcomes.addLink(outcome.id, { kind: 'goal', id: goal.id, relation: 'drives' });
      return {
        outcomeId: outcome.id,
        contractVersion: outcome.latestContractVersion,
        goal,
      };
    });
  }
}

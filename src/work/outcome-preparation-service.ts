import type { Config } from '../config/schema.js';
import type { ProjectService } from '../projects/project-service.js';
import { getRelationshipSettings } from '../storage/sqlite/index.js';
import { createLogger } from '../utils/logger.js';
import {
  ModelOutcomeContractPlanner,
  type OutcomeContractPlanner,
} from './outcome-contract-planner.js';
import { OutcomeExecutionStateRepository } from './outcome-execution-state.js';
import { OutcomeRepository } from './outcome-repository.js';

const log = createLogger('OutcomePreparation');

export class OutcomePreparationService {
  readonly #outcomes = new OutcomeRepository();
  readonly #executions = new OutcomeExecutionStateRepository();
  readonly #planner: OutcomeContractPlanner;

  constructor(private readonly deps: {
    getConfig: () => Config;
    projects: ProjectService;
    planner?: OutcomeContractPlanner;
  }) {
    this.#planner = deps.planner ?? new ModelOutcomeContractPlanner(deps.getConfig);
  }

  async prepare(sessionKey: string): Promise<void> {
    const execution = this.#executions.getBySession(sessionKey);
    if (!execution) return;
    const outcome = this.#outcomes.get(execution.outcomeId);
    if (!outcome || outcome.internalStatus !== 'captured') return;

    this.#outcomes.updateState({
      id: outcome.id,
      userStatus: 'running',
      internalStatus: 'planning',
    });
    try {
      const project = execution.projectId ? this.deps.projects.get(execution.projectId) : undefined;
      const relationship = getRelationshipSettings();
      const contract = await this.#planner.plan({
        objective: outcome.objective,
        projectContext: project ? JSON.stringify({
          name: project.name,
          description: project.description,
          brief: project.brief,
          instructions: project.instructions,
        }) : undefined,
        userContext: JSON.stringify({
          supportMode: relationship.supportMode,
          proactiveEnabled: relationship.proactiveEnabled,
          allowedTopics: relationship.allowedTopics,
          blockedTopics: relationship.blockedTopics,
        }),
      });
      this.#outcomes.reviseContract({
        outcomeId: outcome.id,
        ...contract,
        createdBy: 'system',
      });
      this.#executions.update(outcome.id, {
        nextAction: contract.acceptanceCriteria[0] ?? contract.deliverables[0] ?? null,
      });
    } catch (error) {
      this.#outcomes.updateState({
        id: outcome.id,
        userStatus: 'running',
        internalStatus: 'captured',
      });
      log.warn({ err: error, outcomeId: outcome.id, sessionKey }, 'Outcome planning kept the initial contract');
    }
  }
}

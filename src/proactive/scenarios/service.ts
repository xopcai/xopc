import {
  createPromptDraft,
  getPromptRevision,
  getSubscription,
  getScenario,
  listEnabledRoutes,
  listScenarios,
  listSubscriptions,
  publishPromptRevision,
  rollbackPromptRevision,
  upsertSubscription,
} from './repository.js';
import { composeScenarioPrompt } from './prompt-composer.js';

export class ProactiveScenarioService {
  list = listScenarios;
  subscriptions = listSubscriptions;
  routes = listEnabledRoutes;
  subscribe = upsertSubscription;
  createDraft = createPromptDraft;
  publish = publishPromptRevision;
  rollback = rollbackPromptRevision;

  preview(input: { scenarioKey: string; revisionId?: string; runtimeContext?: string }) {
    const scenario = getScenario(input.scenarioKey);
    if (!scenario) throw new Error('Scenario not found');
    const revision = input.revisionId ? getPromptRevision(input.revisionId) : undefined;
    if (input.revisionId && !revision) throw new Error('Prompt revision not found');
    if (revision && getSubscription(revision.subscriptionId)?.scenarioKey !== scenario.key) {
      throw new Error('Prompt revision does not belong to this scenario');
    }
    return composeScenarioPrompt({ scenario, ...(revision ? { revision } : {}), runtimeContext: input.runtimeContext ?? '[runtime context redacted]' });
  }
}

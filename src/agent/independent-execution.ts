import { withoutCloudCreditBudget } from '../providers/xopc-cloud-credit-budget.js';
import { withoutEmbeddedExecutionSession } from './embedded/execution-context.js';
import { withoutDelegationScope } from './orchestration/delegation-scope.js';
import { withoutDataToolPermissions } from './tools/dataBatch.js';
import { withoutSearchCache } from './tools/search/cache.js';

/** Discard caller-owned execution scopes before resolving the target Agent. */
export function runInIndependentAgentExecution<T>(run: () => T): T {
  return withoutEmbeddedExecutionSession(() => withoutDelegationScope(() =>
    withoutDataToolPermissions(() => withoutSearchCache(() => withoutCloudCreditBudget(run)))));
}

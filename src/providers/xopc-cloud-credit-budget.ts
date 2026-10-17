import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

import type { CloudCreditBudget } from '@xopcai/gateway-contract';

import { XopcCloudAccountService } from './xopc-cloud-account-service.js';
import { createLogger } from '../utils/logger.js';

type BudgetScope = {
  limitCreditMicro: string;
  key: string;
  budget?: Promise<CloudCreditBudget | null>;
  stopped?: string;
  conversationId: string;
  runId: string;
};
const log = createLogger('CloudCreditBudget');
const scopes = new AsyncLocalStorage<BudgetScope>();
const EXHAUSTED = /credit_budget_exhausted|(?:task Credit|Credit task) budget exhausted/i;

export function withoutCloudCreditBudget<T>(run: () => T): T { return scopes.exit(run); }

export function hasCloudCreditBudget(): boolean { return Boolean(scopes.getStore()); }
export function cloudCreditBudgetStopMessage(): string | undefined { return scopes.getStore()?.stopped; }

export function isCloudCreditBudgetExhausted(message: string): boolean {
  return EXHAUSTED.test(message);
}

export function reportCloudCreditError(message: string): void {
  const scope = scopes.getStore();
  if (scope && isCloudCreditBudgetExhausted(message)) scope.stopped = 'credit_budget_exhausted: Credit task budget exhausted';
}

export function assertCloudCreditBudgetActive(): void {
  const stopped = scopes.getStore()?.stopped;
  if (stopped) throw new Error(stopped);
}

/** Children inherit their parent's scope; repeated attempts use the same platform budget. */
export async function withCloudCreditBudget<T>(
  options: { conversationId: string; runId: string; limitCreditMicro?: string },
  action: () => Promise<T>,
): Promise<T> {
  if (scopes.getStore() || !options.limitCreditMicro) return action();
  const key = `xopc-run:${createHash('sha256').update(JSON.stringify([options.conversationId, options.runId])).digest('hex')}`;
  return scopes.run({ key, conversationId: options.conversationId, runId: options.runId, limitCreditMicro: options.limitCreditMicro }, action);
}

export async function cloudCreditBudgetHeaders(
  service?: Pick<XopcCloudAccountService, 'createBudget'>,
): Promise<Record<string, string>> {
  assertCloudCreditBudgetActive();
  const scope = scopes.getStore();
  if (!scope) return {};
  // Cache the promise so concurrent tools create one budget. A failure never falls through unbudgeted.
  scope.budget ??= (service ?? new XopcCloudAccountService()).createBudget(scope.limitCreditMicro, scope.key).then(budget => {
    if (budget) log.info({ conversationId: scope.conversationId, runId: scope.runId,
      creditBudgetId: budget.id, limitCreditMicro: budget.limitCreditMicro }, 'Created Cloud run Credit budget');
    return budget;
  });
  const budget = await scope.budget;
  if (!budget) throw new Error('XOPC Cloud authorization is unavailable');
  assertCloudCreditBudgetActive();
  return { 'x-xopc-credit-budget': budget.id };
}

export function rejectUnbudgetedCloudTransport(operation = 'realtime voice'): void {
  if (scopes.getStore()) throw new Error(`Credit run budgets do not support ${operation} yet`);
}

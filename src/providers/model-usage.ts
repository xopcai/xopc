import { AsyncLocalStorage } from 'node:async_hooks';
import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';

import { isInteractiveOnlyProvider } from './setup/profiles.js';
import { resolveAiUsageScenario } from '../usage/scenario-registry.js';
import type { AiUsageContext } from '../usage/types.js';

export type ModelUsageOrigin = 'interactive' | 'background' | 'unknown';
const scopes = new AsyncLocalStorage<ModelUsageOrigin>();
export const getModelUsageOrigin = (): ModelUsageOrigin => scopes.getStore() ?? 'unknown';

export function modelUsageOriginForCall(context: AiUsageContext): ModelUsageOrigin {
  const trigger = context.trigger ?? resolveAiUsageScenario(context.operation).trigger;
  return trigger === 'user' ? 'interactive' : trigger === 'system' || trigger === 'scheduled' ? 'background' : getModelUsageOrigin();
}

/** A nested task cannot upgrade its parent's background/unknown scope. */
export function withModelUsageOrigin<T>(origin: ModelUsageOrigin, run: () => T): T {
  const parent = scopes.getStore();
  const effective = parent === 'background' || origin === 'background' ? 'background'
    : parent === 'unknown' ? 'unknown' : origin;
  return scopes.run(effective, run);
}
export function modelUsageOriginFromTurn(origin?: TurnOrigin): ModelUsageOrigin {
  if (!origin) return 'unknown';
  if (origin.type !== 'system' || origin.source === 'cli') return 'interactive';

  return 'background';
}
export class ProviderUsageScopeError extends Error {
  readonly code = 'provider_usage_scope_denied';
  constructor(provider: string, origin: ModelUsageOrigin) {
    super(`provider_usage_scope_denied: ${provider} requires an interactive user turn; ${origin} calls need a background-capable model.`);
    this.name = 'ProviderUsageScopeError';
  }
}
/** Transport wrappers may preserve only the error message or code. */
export function isProviderUsageScopeError(error: unknown): boolean {
  return error instanceof ProviderUsageScopeError
    || Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'provider_usage_scope_denied')
    || (error instanceof Error ? error.message : typeof error === 'string' ? error : '').includes('provider_usage_scope_denied');
}
export function assertProviderUsage(provider: string, baseUrl?: string): void {
  const origin = getModelUsageOrigin();
  if (origin !== 'interactive' && isInteractiveOnlyProvider(provider, baseUrl)) throw new ProviderUsageScopeError(provider, origin);
}

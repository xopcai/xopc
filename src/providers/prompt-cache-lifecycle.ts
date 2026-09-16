import type { Api, Model } from '@earendil-works/pi-ai';

import type { PromptCachePolicy } from './prompt-cache-plan.js';

const cacheTouchByScope = new Map<string, number>();
const MAX_CACHE_TOUCHES = 512;

function scopeKey(conversationId: string, model: Model<Api>): string {
  return `${conversationId}\0${model.provider}/${model.id}`;
}

export function resolvePromptCacheTtlMs(model: Model<Api>, policy: PromptCachePolicy): number {
  if (model.api === 'openai-responses' && /^gpt-5\.6(?:-|$)/.test(model.id)) {
    return 30 * 60_000;
  }
  return policy.lifetime === 'long' ? 60 * 60_000 : 5 * 60_000;
}

export function recordPromptCacheTouch(
  conversationId: string,
  model: Model<Api>,
  usage: { cacheRead?: number; cacheWrite?: number },
  now = Date.now(),
): void {
  if ((usage.cacheRead ?? 0) <= 0 && (usage.cacheWrite ?? 0) <= 0) return;
  const key = scopeKey(conversationId, model);
  cacheTouchByScope.delete(key);
  cacheTouchByScope.set(key, now);
  while (cacheTouchByScope.size > MAX_CACHE_TOUCHES) {
    const oldest = cacheTouchByScope.keys().next().value;
    if (typeof oldest !== 'string') break;
    cacheTouchByScope.delete(oldest);
  }
}

export function isPromptCacheExpired(
  conversationId: string,
  model: Model<Api>,
  policy: PromptCachePolicy,
  now = Date.now(),
): boolean {
  if (policy.mode === 'off') return false;
  const touchedAt = cacheTouchByScope.get(scopeKey(conversationId, model));
  return touchedAt !== undefined && now - touchedAt >= resolvePromptCacheTtlMs(model, policy);
}

export function clearPromptCacheTouches(): void {
  cacheTouchByScope.clear();
}

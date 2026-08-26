import type { Api, Model } from '@earendil-works/pi-ai';

import { splitPromptCacheBoundary, stripPromptCacheBoundary } from '../agent/prompt/cache-boundary.js';
import { digestCacheText, digestCacheValue } from './prompt-cache-fingerprint.js';

const MAX_TRACKED_SCOPES = 512;

export type PromptCacheChangeReason =
  | 'model_changed'
  | 'reasoning_changed'
  | 'system_changed'
  | 'dynamic_context_changed'
  | 'tools_changed';

export interface PromptCacheSnapshot {
  modelRef: string;
  api: string;
  reasoning?: string;
  stableSystemDigest: string;
  dynamicSystemDigest: string;
  toolDigest: string;
  toolCount: number;
}

const previousByScope = new Map<string, PromptCacheSnapshot>();

export function buildPromptCacheSnapshot(params: {
  model: Model<Api>;
  systemPrompt?: string;
  tools?: unknown[];
  reasoning?: string;
}): PromptCacheSnapshot {
  const rawPrompt = params.systemPrompt ?? '';
  const split = splitPromptCacheBoundary(rawPrompt);
  return {
    modelRef: `${params.model.provider}/${params.model.id}`,
    api: params.model.api,
    ...(params.reasoning ? { reasoning: params.reasoning } : {}),
    stableSystemDigest: digestCacheText(split?.stablePrefix ?? stripPromptCacheBoundary(rawPrompt)),
    dynamicSystemDigest: digestCacheText(split?.dynamicSuffix ?? ''),
    toolDigest: digestCacheValue(params.tools ?? []),
    toolCount: params.tools?.length ?? 0,
  };
}

export function diffPromptCacheSnapshots(
  previous: PromptCacheSnapshot | undefined,
  next: PromptCacheSnapshot,
): PromptCacheChangeReason[] {
  if (!previous) return [];
  const reasons: PromptCacheChangeReason[] = [];
  if (previous.modelRef !== next.modelRef || previous.api !== next.api) reasons.push('model_changed');
  if (previous.reasoning !== next.reasoning) reasons.push('reasoning_changed');
  if (previous.stableSystemDigest !== next.stableSystemDigest) reasons.push('system_changed');
  if (previous.dynamicSystemDigest !== next.dynamicSystemDigest) reasons.push('dynamic_context_changed');
  if (previous.toolDigest !== next.toolDigest) reasons.push('tools_changed');
  return reasons;
}

export function observePromptCacheSnapshot(
  scope: string,
  snapshot: PromptCacheSnapshot,
): PromptCacheChangeReason[] {
  const previous = previousByScope.get(scope);
  const reasons = diffPromptCacheSnapshots(previous, snapshot);
  previousByScope.delete(scope);
  previousByScope.set(scope, snapshot);
  while (previousByScope.size > MAX_TRACKED_SCOPES) {
    const oldest = previousByScope.keys().next().value;
    if (typeof oldest !== 'string') break;
    previousByScope.delete(oldest);
  }
  return reasons;
}

export function clearPromptCacheObservations(): void {
  previousByScope.clear();
}

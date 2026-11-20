import type { EffectiveAgentConfig } from '../../agent-config/index.js';
import { getApiKey, resolveModel } from '../../providers/index.js';
import { assertProviderUsage, getModelUsageOrigin } from '../../providers/model-usage.js';
import type { ModelManager } from './manager.js';

export function resolveTurnModelRefs(modelManager: ModelManager, conversationId: string,
  effective?: EffectiveAgentConfig, voiceModelRef?: string, checkCredentials = false) {
  const configured = modelManager.getModelForSession(conversationId);
  const background = !voiceModelRef && getModelUsageOrigin() === 'background'
    && !modelManager.hasSessionModelOverride?.(conversationId) && configured === effective?.models.chat.primary
    ? effective.models.background : undefined;
  const candidates = modelManager.getFallbackCandidatesForSession?.(conversationId, checkCredentials);
  const selected = voiceModelRef ?? background?.primary ?? configured;
  const refs = voiceModelRef ? [voiceModelRef] : background ? [background.primary, ...background.fallbacks]
    : candidates?.length ? candidates.map(candidate => `${candidate.provider}/${candidate.model}`) : [configured];
  return { configured, selected, refs, useSessionModel: !voiceModelRef && !background };
}

export class TaskModelPreflightError extends Error {
  constructor(
    readonly code: 'provider_setup_required' | 'provider_auth_invalid' | 'task_model_unavailable',
    readonly modelRef: string,
    readonly provider?: string,
  ) {
    super(`No usable credentials or model for task execution (${modelRef})`);
    this.name = 'TaskModelPreflightError';
  }
}

/** Resolve the configured background candidates without sending a model request. */
export async function resolveAvailableTaskModels(refs: string[], selected: string) {
  const authByProvider = new Map<string, Promise<'ready' | 'missing' | 'invalid'>>();
  const candidates = [];
  let authFailure: TaskModelPreflightError | undefined;
  for (const ref of new Set(refs)) {
    let model: ReturnType<typeof resolveModel>;
    try {
      model = resolveModel(ref);
      assertProviderUsage(model.provider, model.baseUrl);
    } catch {
      continue;
    }
    let auth = authByProvider.get(model.provider);
    if (!auth) {
      auth = getApiKey(model.provider).then(key => key?.trim() ? 'ready' : 'missing', () => 'invalid');
      authByProvider.set(model.provider, auth);
    }
    const status = await auth;
    if (status === 'ready') candidates.push({ ref, model });
    else authFailure ??= new TaskModelPreflightError(
      status === 'missing' ? 'provider_setup_required' : 'provider_auth_invalid', ref, model.provider);
  }
  if (candidates.length === 0) throw authFailure ?? new TaskModelPreflightError('task_model_unavailable', selected);
  return candidates;
}

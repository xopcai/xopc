import { createHash } from 'node:crypto';
import type { ModelSetupPreview, ModelSetupRequest, ModelSetupUse, ProviderSetupProfile } from '@xopcai/gateway-contract';

import { isInteractiveOnlyProvider } from './profiles.js';
import type { AgentDefaults } from '../../agent-config/index.js';
import type { SetupVoiceState, SetupVoiceModel, VoiceSetupUse } from './voice.js';

export type SetupModel = { ref: string; name: string; baseUrl?: string; api?: string; vision?: boolean; reasoning?: boolean; recommended?: boolean };
export type SetupSnapshot = {
  profile: ProviderSetupProfile;
  defaults: AgentDefaults;
  models: SetupModel[];
  images: Array<{ ref: string; name: string }>;
  configured: boolean;
  configuredProviders: Set<string>;
  backgroundRestrictedModels?: Set<string>;
  voice?: SetupVoiceState;
};
const preferred: Record<string, { fast: string[]; reasoning: string[] }> = {
  'qwen-token-plan-cn': { fast: ['qwen3.8-flash', 'qwen3.7-plus', 'qwen3.6-flash'], reasoning: ['qwen3.8-max', 'deepseek-v4-pro-0813', 'deepseek-v4-pro'] },
  'xopc-cloud': { fast: ['auto'], reasoning: ['advanced', 'auto'] },
  'xiaomi-token-plan-cn': { fast: ['mimo-v2.5', 'mimo-v2.5-pro'], reasoning: ['mimo-v2.5-pro', 'mimo-v2.5'] },
};
const uses: ModelSetupUse[] = ['chat', 'vision', 'image', 'background'];
export class SetupConflictError extends Error {}

function choose(models: SetupModel[], ids: string[], provider: string): string | undefined {
  return ids.map(id => models.find(model => model.ref === `${provider}/${id}`)?.ref).find(Boolean)
    ?? models.find(model => model.recommended)?.ref
    ?? (models.length === 1 ? models[0]?.ref : undefined);
}

/** Pure preview over authoritative catalog and defaults; never writes or probes a model. */
export function previewProviderSetup(snapshot: SetupSnapshot, request: ModelSetupRequest = {}): ModelSetupPreview {
  const { profile, defaults, configured, configuredProviders } = snapshot;
  const models = snapshot.models.filter(model => !request.modelIds || request.modelIds.some(id => model.ref === id || model.ref === `${profile.id}/${id}`));
  const vision = models.filter(model => model.vision);
  const reasoning = models.filter(model => model.reasoning);
  const preference = preferred[profile.id] ?? { fast: [], reasoning: [] };
  const fast = choose(models, preference.fast, profile.id);
  const complex = choose(reasoning, preference.reasoning, profile.id);
  const isRestricted = (ref: string) => snapshot.backgroundRestrictedModels?.has(ref)
    || isInteractiveOnlyProvider(ref.split('/')[0]!, snapshot.models.find(model => model.ref === ref)?.baseUrl);
  const background = profile.interactiveOnly ? [] : models.filter(model => !isRestricted(model.ref));
  const recommended: Partial<Record<ModelSetupUse, string>> = {
    chat: fast,
    vision: choose(vision, preference.fast, profile.id),
    image: snapshot.images[0]?.ref,
    background: choose(background, preference.fast, profile.id),
  };
  const choices: Partial<Record<ModelSetupUse, Array<{ ref: string; name: string }>>> = {
    chat: models, vision, image: snapshot.images, background,
  };
  const current: Partial<Record<ModelSetupUse, string>> = {
    chat: defaults.models.chat.primary,
    vision: defaults.models.imageUnderstanding?.primary,
    image: defaults.models.imageGeneration?.primary,
    background: defaults.models.background?.primary ?? (!isRestricted(defaults.models.chat.primary) ? defaults.models.chat.primary : undefined),
  };
  for (const id of Object.keys(snapshot.voice?.choices ?? {}) as VoiceSetupUse[]) {
    const options = snapshot.voice!.choices[id];
    choices[id] = options;
    recommended[id] = options.find(model => model.recommended)?.ref ?? (options.length === 1 ? options[0]?.ref : undefined);
    current[id] = snapshot.voice!.current[id];
  }
  const revision = createHash('sha256').update(JSON.stringify({ defaults, profile, models: snapshot.models, images: snapshot.images, voice: snapshot.voice,
    backgroundRestrictedModels: [...snapshot.backgroundRestrictedModels ?? []].sort() })).digest('hex');
  return {
    providerId: profile.id, profile, revision, configured, mode: request.mode ?? 'fill',
    taskModels: { ...(fast ? { fast } : {}), ...(complex ? { reasoning: complex, coding: complex, review: complex } : {}), ...(recommended.vision ? { vision: recommended.vision } : {}), ...(recommended.background ? { understanding: recommended.background } : {}) },
    uses: [...uses, ...(snapshot.voice ? ['transcription', 'speech', 'conversation'] as const : [])].map(id => {
      const options = (choices[id] ?? []).map(model => ({ id: model.ref, name: model.name }));
      const override = request.overrides?.[id];
      if (override && !options.some(model => model.id === override)) throw new Error(`Invalid ${id} model for ${profile.id}`);
      const ref = override ?? recommended[id];
      const currentProvider = current[id]?.split('/')[0];
      const currentConfigured = currentProvider && (configuredProviders.has(currentProvider) || ['speech', 'transcription', 'conversation'].includes(id))
        && (id !== 'background' || !isRestricted(current[id]!));
      const selected = options.length > 0 && Boolean(ref) && (request.selected ? request.selected.includes(id) : request.mode === 'replace' || !currentConfigured);
      return { id, current: current[id], recommended: ref, choices: options, selected,
        ...(!options.length ? { reason: id === 'background' && profile.interactiveOnly ? 'interactive_only' as const : 'not_supported' as const }
          : !ref ? { reason: 'no_recommendation' as const } : {}) };
    }),
  };
}

export function applyProviderSetup(snapshot: SetupSnapshot, request: ModelSetupRequest, revision: string): { defaults: AgentDefaults; preview: ModelSetupPreview; voiceAssignments: Array<{ use: VoiceSetupUse; model: SetupVoiceModel }> } {
  const preview = previewProviderSetup(snapshot, request);
  if (revision !== preview.revision) throw new SetupConflictError('Model catalog or settings changed. Review the refreshed configuration.');
  for (const id of request.selected ?? []) {
    if (!preview.uses.some(use => use.id === id && use.selected)) throw new Error(`No eligible model selected for ${id}`);
  }
  if (!snapshot.configured) throw new Error('Connect this model service before applying its models.');
  const models = structuredClone(snapshot.defaults.models);
  const voiceAssignments: Array<{ use: VoiceSetupUse; model: SetupVoiceModel }> = [];
  const route = (primary: string) => ({ primary, fallbacks: [] });
  for (const use of preview.uses) {
    if (!use.selected) continue;
    if (!use.recommended) throw new Error(`Choose a model for ${use.id}`);
    if (use.id === 'chat') {
      models.chat = route(use.recommended);
    } else if (use.id === 'vision') models.imageUnderstanding = route(use.recommended);
    else if (use.id === 'image') models.imageGeneration = { ...models.imageGeneration, ...route(use.recommended), autoProviderFallback: false };
    else if (use.id === 'background') models.background = route(use.recommended);
    else {
      const voiceUse = use.id as VoiceSetupUse;
      const model = snapshot.voice?.choices[voiceUse].find(model => model.ref === use.recommended);
      if (!model) throw new Error(`No voice binding for ${use.id}`);
      voiceAssignments.push({ use: voiceUse, model });
    }
  }
  for (const [intent, ref] of Object.entries(preview.taskModels)) {
    const key = intent as keyof typeof preview.taskModels;
    const useId = intent === 'vision' ? 'vision' : intent === 'understanding' ? 'background' : 'chat';
    if (!preview.uses.some(use => use.id === useId && use.selected)) continue;
    const existing = models.intents[key];
    const keep = request.mode !== 'replace' && existing && snapshot.configuredProviders.has(existing.primary.split('/')[0]!);
    if (ref && !keep) models.intents[key] = route(ref);
  }
  return { defaults: { ...snapshot.defaults, models }, preview, voiceAssignments };
}

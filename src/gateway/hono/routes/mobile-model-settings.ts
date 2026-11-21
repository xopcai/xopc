import { createHash } from 'node:crypto';

import { HIGGS_REALTIME_REF } from '@xopcai/realtime-protocol/voice';
import type { Hono } from 'hono';
import { z } from 'zod';

import { listImageGenerationProviders } from '../../../agent/image/generation/provider-registry.js';
import { ModelIntentSchema, ModelRefSchema, type AgentModelsDefaults } from '../../../agent-config/index.js';
import { getCredentialResolver } from '../../../auth/credentials.js';
import type { Config } from '../../../config/schema.js';
import { readMusicModelSettings } from '../../../music-generation/providers.js';
import { saveMusicModel } from '../../../music-generation/settings.js';
import { getAllProviders, getProviderDisplayName, isProviderConfigured } from '../../../providers/index.js';
import { getModelCatalogStore } from '../../../providers/model-catalog-store.js';
import { previewProviderSetup } from '../../../providers/setup/engine.js';
import { applySetupVoice, readSetupVoiceState, voiceSetupUses, type SetupVoiceModel } from '../../../providers/setup/voice.js';
import { getAvailableVideoModelRefs, getConfiguredVideoProviders } from '../../../video-generation/providers.js';
import { getVideoModel, getVideoModelDefinition, setVideoModel } from '../../../video-generation/settings.js';
import { listSttProvidersForApi } from '../../../voice/stt/list-providers.js';
import { listTtsProvidersForApi } from '../../../voice/tts/list-providers.js';
import { listGlobalDefaults, updateGlobalDefaults } from '../../global-defaults-admin.js';
import { readProviderSetupSnapshot } from '../../provider-model-setup.js';
import { getPersonalOwnerId } from '../../security/gateway-principal.js';
import { withGatewayConfigWriteLock } from '../lib/config-write-lock.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const path = '/api/mobile/model-settings';
const uses = z.enum(['chat', 'background', 'vision', 'image', 'transcription', 'speech', 'conversation', 'video', 'music']);
const modelRef = ModelRefSchema.max(512);
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const changeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('model'), key: uses, ref: modelRef.nullable(), revision }),
  z.strictObject({ kind: z.literal('task'), key: ModelIntentSchema, ref: modelRef.nullable(), revision }),
  z.strictObject({ kind: z.literal('fallbacks'), refs: z.array(modelRef), revision }),
]);

type Use = z.infer<typeof uses>;
type Option = { ref: string; name: string; provider: string; displayNames?: Partial<Record<'zh-CN' | 'en', string>> };
type Selection = { key: string; pool: Use; ref: string | null; name: string | null; inherited?: boolean; allowInherit?: boolean };
type Change = z.infer<typeof changeSchema>;

function option(ref: string, name: string, provider: string): Option {
  const prefix = `${provider}/`;
  const modelId = ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
  const displayNames = getModelCatalogStore().getSource(provider)?.models.find(model => model.id === modelId)?.displayNames;
  return { ref, name, provider: getProviderDisplayName(provider), ...(displayNames ? { displayNames } : {}) };
}
const ordered = (choices: Option[]): Option[] => [...new Map(choices.map(choice => [choice.ref, choice])).values()]
  .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name) || a.ref.localeCompare(b.ref));

async function readSettings(config: Config) {
  const [languageProviders, videoProviders, music, boson] = await Promise.all([
    Promise.all(getAllProviders().map(async id => [id, await isProviderConfigured(id)] as const)),
    getConfiguredVideoProviders(), readMusicModelSettings(), getCredentialResolver().hasCredentials('boson'),
  ]);
  const configured = new Map(languageProviders);
  const providerIds = new Set([
    ...languageProviders.filter(([, available]) => available).map(([id]) => id),
    ...listImageGenerationProviders().filter(provider => provider.isConfigured({ cfg: config })).map(provider => provider.id),
    ...listSttProvidersForApi(config).providers.filter(provider => provider.configured).map(provider => provider.id),
    ...listTtsProvidersForApi(config).providers.filter(provider => provider.configured).map(provider => provider.id),
  ]);
  const defaults = listGlobalDefaults().defaults;
  const providers = [...providerIds].map(id => readProviderSetupSnapshot(id, configured.get(id) ?? false, config)).filter(provider => provider.configured);
  const previews = providers.map(provider => previewProviderSetup(provider));
  const available = (use: Use) => previews.flatMap(preview =>
    (preview.uses.find(row => row.id === use)?.choices ?? []).map(choice => option(choice.id, choice.name, preview.providerId)));
  const voiceModels = (use: typeof voiceSetupUses[number]) => providers.flatMap(state => state.voice?.choices[use] ?? []);
  const video = getVideoModel();
  const videoModels = getAvailableVideoModelRefs().filter(ref => videoProviders[getVideoModelDefinition(ref).provider]);
  const pools: Record<Use, Option[]> = {
    chat: available('chat'),
    background: available('background'),
    vision: available('vision'),
    image: available('image'),
    transcription: available('transcription'),
    speech: available('speech'),
    conversation: [...available('conversation'), ...(boson ? [option(HIGGS_REALTIME_REF, 'Higgs Realtime', 'boson')] : [])],
    video: videoModels.map(ref => {
      const model = getVideoModelDefinition(ref);
      return option(ref, model.name, model.provider);
    }),
    music: music.models.filter(model => music.credentials[model.providerId] && music.credentials[model.providerId] !== 'missing')
      .map(model => option(model.ref, model.name, model.providerId)),
  };
  for (const use of uses.options) pools[use] = ordered(pools[use]);
  const { chat, background, imageUnderstanding, imageGeneration, intents } = defaults.models;
  const currentVoice = readSetupVoiceState('', config).current;
  const selection = (key: string, pool: Use, ref: string | undefined, allowInherit = false): Selection => ({
    key, pool, ref: ref || null, name: pools[pool].find(item => item.ref === ref)?.name ?? ref ?? null,
    ...(allowInherit ? { allowInherit, inherited: !ref } : {}),
  });
  const routing = [
    selection('chat', 'chat', chat.primary),
    selection('background', 'background', background?.primary, true),
    selection('vision', 'vision', imageUnderstanding?.primary),
    selection('image', 'image', imageGeneration?.primary),
    selection('transcription', 'transcription', config.tools.media?.audio?.enabled ? currentVoice.transcription : undefined),
    selection('speech', 'speech', config.messages?.tts?.enabled ? currentVoice.speech : undefined),
    selection('conversation', 'conversation', config.voice?.realtime.boson?.defaultForNatural || config.voice?.realtime.enabled ? currentVoice.conversation : undefined),
    selection('video', 'video', video),
    selection('music', 'music', music.modelRef),
  ];
  const tasks = ModelIntentSchema.options.map(key => selection(key, key === 'vision' ? 'vision' : 'chat', intents[key]?.primary, true));
  const fallbacks = chat.fallbacks.map(ref => pools.chat.find(choice => choice.ref === ref) ?? option(ref, ref, ref.split('/')[0]!));
  const revision = createHash('sha256').update(JSON.stringify([
    defaults.models, config.messages?.tts, config.tools.media?.audio, config.voice, video, music.modelRef,
  ])).digest('hex');
  return { defaults, videoModels, voiceModels, payload: { revision, routing, tasks, fallbacks, pools } };
}

/** Update one setting without replacing the other global model routes. */
export function changeDefaultModels(models: AgentModelsDefaults, change: Change): AgentModelsDefaults {
  const next = structuredClone(models);
  if (change.kind === 'fallbacks') {
    next.chat.fallbacks = change.refs;
  } else if (change.kind === 'task') {
    if (change.ref) next.intents[change.key] = { primary: change.ref, fallbacks: next.intents[change.key]?.fallbacks.filter(ref => ref !== change.ref) ?? [] };
    else delete next.intents[change.key];
  } else {
    const ref = change.ref;
    const route = (fallbacks: string[]) => ({ primary: ref!, fallbacks: fallbacks.filter(model => model !== ref) });
    if (change.key === 'chat') next.chat = route(next.chat.fallbacks);
    if (change.key === 'background') {
      if (ref) next.background = route(next.background?.fallbacks ?? []);
      else delete next.background;
    }
    if (change.key === 'vision') next.imageUnderstanding = route(next.imageUnderstanding?.fallbacks ?? []);
    if (change.key === 'image') {
      next.imageGeneration = { autoProviderFallback: false, ...next.imageGeneration, ...route(next.imageGeneration?.fallbacks ?? []) };
    }
  }
  return next;
}

function usableChange(change: Change, { payload }: Awaited<ReturnType<typeof readSettings>>): boolean {
  if (change.kind === 'fallbacks') {
    const current = new Set(payload.fallbacks.map(item => item.ref));
    const primary = payload.routing.find(item => item.key === 'chat')?.ref;
    const allowed = new Set(payload.pools.chat.map(item => item.ref));
    return change.refs.length === new Set(change.refs).size && change.refs.every(ref =>
      ref !== primary && (current.has(ref) || allowed.has(ref)));
  }
  const row = (change.kind === 'task' ? payload.tasks : payload.routing).find(item => item.key === change.key);
  return Boolean(row && (change.ref === null ? row.allowInherit : payload.pools[row.pool].some(choice => choice.ref === change.ref)));
}

export function registerMobileModelSettingsRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;
  app.get(path, async c => {
    if (!getPersonalOwnerId(c)) return c.json({ ok: false, error: { message: 'A paired owner device is required.' } }, 403);
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, payload: (await readSettings(service.currentConfig)).payload });
  });
  app.patch(path, deps.strictRateLimitMiddleware, async c => {
    if (!getPersonalOwnerId(c)) return c.json({ ok: false, error: { message: 'A paired owner device is required.' } }, 403);
    c.header('Cache-Control', 'no-store');
    const parsed = changeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { message: 'Invalid model setting.' } }, 400);
    const change = parsed.data;
    return withGatewayConfigWriteLock(service, async () => {
      const config = service.currentConfig;
      const snapshot = await readSettings(config);
      if (change.revision !== snapshot.payload.revision || config !== service.currentConfig) {
        return c.json({ ok: false, error: { code: 'MODEL_SETTINGS_CHANGED', message: 'Model settings changed. Reload before trying again.' } }, 409);
      }
      if (!usableChange(change, snapshot)) {
        return c.json({ ok: false, error: { message: 'This choice is not available for the selected use.' } }, 400);
      }
      if (change.kind === 'model' && change.key === 'video') {
        setVideoModel(snapshot.videoModels.find(ref => ref === change.ref)!);
      } else if (change.kind === 'model' && change.key === 'music') {
        saveMusicModel(change.ref!);
      } else if (change.kind === 'model' && (change.key === 'transcription' || change.key === 'speech' || change.key === 'conversation')) {
        const use = change.key;
        let next: Config;
        if (use === 'conversation' && change.ref === HIGGS_REALTIME_REF) {
          next = structuredClone(config);
          next.voice.realtime.boson = { voice: next.voice.realtime.boson?.voice ?? 'default', defaultForNatural: true };
        } else {
          const model: SetupVoiceModel = snapshot.voiceModels(use).find(item => item.ref === change.ref)!;
          next = applySetupVoice(config, [{ use, model }]);
        }
        const saved = await service.saveConfig(next, config);
        if (!saved.saved) {
          return c.json({ ok: false, error: { message: saved.error ?? 'Could not save model settings.' } }, saved.conflict ? 409 : 500);
        }
      } else {
        const defaults = snapshot.defaults;
        const result = updateGlobalDefaults({ scope: 'models', expectedModels: defaults.models,
          defaults: { ...defaults, models: changeDefaultModels(defaults.models, change) } });
        if (result.ok === false) return c.json({ ok: false, error: { message: result.error } }, result.status ?? 400);
        if (result.data.changed) service.refreshAgentCatalog();
      }
      return c.json({ ok: true, payload: (await readSettings(service.currentConfig)).payload });
    });
  });
}

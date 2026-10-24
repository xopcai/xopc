import { voiceSupportsMode, type VoiceModeCapability } from '@xopcai/realtime-protocol/voice';

import { phoneModelProfile } from '../phone/model-adapter.js';
import { isComputerModel, isDedicatedComputerProfile } from '../computer/model-policy.js';
import { ConfigSchema, type Config } from '../config/schema.js';
import { DEFAULT_AGENT_MODEL_REF, type AgentDefaults } from '../agent-config/index.js';
import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { AgentCatalogService } from '../agent-catalog/service.js';
import type { CatalogModel, CatalogSource } from '../providers/model-catalog-store.js';
import { getModelCatalogStore } from '../providers/model-catalog-store.js';
import { compareCatalogModels } from '../providers/model-catalog-ranking.js';
import { prepareUpdateGlobalDefaults } from './global-defaults-admin.js';

type CloudCapability = 'chat' | 'vision' | 'image-generation' | 'stt' | 'tts';

export interface XopcCloudCapabilitySelection {
  chat: string;
  vision: string;
  imageGeneration: string;
  stt: string;
  tts: string;
  ttsVoice: string;
  realtimeStt?: string;
  realtimeTts?: { model: string; voice: string };
  realtimeOmni?: { model: string; voice: string };
}

export type PrepareXopcCloudCapabilitySetupResult =
  | { ok: true; config: Config; defaults: AgentDefaults; selection: XopcCloudCapabilitySelection }
  | { ok: false; error: string; missing: CloudCapability[] };

export type ApplyXopcCloudCapabilitySetupResult =
  | { configured: true; selection: Partial<XopcCloudCapabilitySelection>; missing: CloudCapability[] }
  | { configured: false; error: string; missing?: CloudCapability[] };

function supportsCapability(model: CatalogModel, capability: CloudCapability): boolean {
  if (model.availability !== 'available' || model.phoneUse || isDedicatedComputerProfile(model.computerUse?.profile)) return false;
  if (capability === 'chat') {
    return model.kind === 'language'
      && (model.operations.includes('chat.completions') || model.operations.includes('responses'));
  }
  if (capability === 'vision') {
    return model.kind === 'language' && model.input.includes('image');
  }
  if (capability === 'image-generation') {
    return model.kind === 'image' && model.operations.includes('images.generate');
  }
  if (capability === 'stt') {
    return model.kind === 'stt' && model.operations.includes('audio.transcription');
  }
  return model.kind === 'tts'
    && model.operations.includes('audio.speech')
    && Boolean(model.tts?.defaultVoice);
}

function recommendedModel(
  source: CatalogSource,
  capability: CloudCapability,
): CatalogModel | undefined {
  const recommendation = capability === 'chat'
    ? source.recommendedModel ?? undefined
    : source.recommended?.[capability];
  return source.models
    .filter((model) => supportsCapability(model, capability))
    .sort((left, right) => compareCatalogModels(left, right, recommendation))[0];
}

function recommendedVoiceModel(
  source: CatalogSource,
  mode: VoiceModeCapability,
): CatalogModel | undefined {
  const recommendation = mode === 'transcription.stream'
    ? source.recommended?.stt
    : mode === 'speech.stream' ? source.recommended?.tts : undefined;
  return source.models
    .filter((model) => model.availability === 'available'
      && model.voice?.modes.includes(mode)
      && (mode === 'transcription.stream' || model.voice.voices.some(voice => voiceSupportsMode(voice, mode))))
    .sort((left, right) => compareCatalogModels(left, right, recommendation))[0];
}

function selectedVoice(model: CatalogModel, mode: VoiceModeCapability): string {
  const voices = model.voice?.voices.filter(voice => voiceSupportsMode(voice, mode)) ?? [];
  return voices.find((voice) => voice.id === 'Cherry')?.id
    ?? voices.find((voice) => voice.id === model.voice?.defaultVoice)?.id
    ?? voices[0].id;
}

export function selectXopcCloudCapabilities(
  source: CatalogSource,
): { selection?: XopcCloudCapabilitySelection; missing: CloudCapability[] } {
  const chat = recommendedModel(source, 'chat');
  const vision = recommendedModel(source, 'vision');
  const imageGeneration = recommendedModel(source, 'image-generation');
  const stt = recommendedModel(source, 'stt');
  const tts = recommendedModel(source, 'tts');
  const realtimeStt = recommendedVoiceModel(source, 'transcription.stream');
  const realtimeTts = recommendedVoiceModel(source, 'speech.stream');
  const realtimeOmni = recommendedVoiceModel(source, 'conversation');
  const missing: CloudCapability[] = [];
  if (!chat) missing.push('chat');
  if (!vision) missing.push('vision');
  if (!imageGeneration) missing.push('image-generation');
  if (!stt) missing.push('stt');
  if (!tts) missing.push('tts');
  if (!chat || !vision || !imageGeneration || !stt || !tts || !tts.tts?.defaultVoice) {
    return { missing };
  }
  return {
    missing,
    selection: {
      chat: chat.id,
      vision: vision.id,
      imageGeneration: imageGeneration.id,
      stt: stt.id,
      tts: tts.id,
      ttsVoice: tts.tts.defaultVoice,
      ...(realtimeStt ? { realtimeStt: realtimeStt.id } : {}),
      ...(realtimeTts ? { realtimeTts: { model: realtimeTts.id, voice: selectedVoice(realtimeTts, 'speech.stream') } } : {}),
      ...(realtimeOmni ? { realtimeOmni: { model: realtimeOmni.id, voice: selectedVoice(realtimeOmni, 'conversation') } } : {}),
    },
  };
}

/** Fill model uses without enabling desktop control or replacing explicit routes. */
export function completeXopcCloudModelRoutes(models: AgentDefaults['models'], source: CatalogSource): AgentDefaults['models'] {
  const next = structuredClone(models);
  const chat = recommendedModel(source, 'chat');
  const vision = recommendedModel(source, 'vision');
  const reasoning = source.models.filter(model => supportsCapability(model, 'chat') && model.reasoning)
    .sort((left, right) => compareCatalogModels(left, right, 'advanced'))[0] ?? chat;
  const route = (model: CatalogModel) => ({ primary: `xopc-cloud/${model.id}`, fallbacks: [] });
  if (chat) {
    next.background ??= route(chat);
    next.intents.fast ??= route(chat);
    next.intents.understanding ??= structuredClone(next.background);
  }
  if (reasoning) {
    for (const intent of ['reasoning', 'coding', 'review'] as const) next.intents[intent] ??= route(reasoning);
  }
  if (vision) next.intents.vision ??= route(vision);
  const computer = source.models.filter(model => model.availability === 'available'
    && isComputerModel({ ...model, provider: source.providerId, api: source.api }))
    .sort((left, right) => compareCatalogModels(left, right))[0];
  if (computer) next.computerUse ??= route(computer);
  const phone = source.models.filter(model => model.availability === 'available'
    && phoneModelProfile({ ...model, api: source.api }))
    .sort((left, right) => compareCatalogModels(left, right, 'phone'))[0];
  if (phone) next.phoneUse ??= route(phone);
  return next;
}

/** Build one atomic config update for the managed XOPC Cloud chat and media capabilities. */
export function prepareXopcCloudCapabilitySetup(
  config: Config,
  source: CatalogSource,
): PrepareXopcCloudCapabilitySetupResult {
  const selected = selectXopcCloudCapabilities(source);
  if (!selected.selection) {
    return {
      ok: false,
      error: `XOPC Cloud is missing required capabilities: ${selected.missing.join(', ')}`,
      missing: selected.missing,
    };
  }

  const selection = selected.selection;
  const currentDefaults = new AgentCatalogRepository().getSettings().defaults;
  const currentModels = currentDefaults.models;
  const defaultsUpdate = prepareUpdateGlobalDefaults({
    defaults: {
      ...currentDefaults,
      models: completeXopcCloudModelRoutes({
        ...currentModels,
        chat: { primary: `xopc-cloud/${selection.chat}`, fallbacks: [] },
        imageUnderstanding: {
          ...currentModels.imageUnderstanding,
          primary: `xopc-cloud/${selection.vision}`,
          fallbacks: currentModels.imageUnderstanding?.fallbacks ?? [],
        },
        imageGeneration: {
          ...currentModels.imageGeneration,
          primary: `xopc-cloud/${selection.imageGeneration}`,
          fallbacks: currentModels.imageGeneration?.fallbacks ?? [],
        },
      }, source),
    },
  });
  if (defaultsUpdate.ok === false) {
    return { ok: false, error: defaultsUpdate.error, missing: [] };
  }

  const currentStt = config.tools?.media?.audio;
  const currentTts = config.messages?.tts;
  return {
    ok: true,
    selection,
    defaults: defaultsUpdate.data.defaults,
    config: {
      ...config,
      tools: {
        ...config.tools,
        media: {
          ...config.tools?.media,
          audio: {
            ...currentStt,
            enabled: true,
            provider: 'xopc-cloud',
            fallback: { enabled: false, order: ['xopc-cloud'] },
            providers: {
              ...(currentStt?.providers ?? {}),
              'xopc-cloud': {
                ...(currentStt?.providers?.['xopc-cloud'] ?? {}),
                model: selection.stt,
              },
            },
          },
        },
      },
      messages: {
        ...config.messages,
        tts: {
          ...currentTts,
          enabled: true,
          provider: 'xopc-cloud',
          trigger: currentTts?.trigger ?? 'off',
          maxTextLength: currentTts?.maxTextLength ?? 512,
          timeoutMs: currentTts?.timeoutMs ?? 60_000,
          providers: {
            ...(currentTts?.providers ?? {}),
            'xopc-cloud': {
              ...(currentTts?.providers?.['xopc-cloud'] ?? {}),
              model: selection.tts,
              voice: selection.ttsVoice,
            },
          },
        },
      },
      ...(selection.realtimeStt || selection.realtimeTts || selection.realtimeOmni ? {
        voice: {
          ...config.voice,
          realtime: {
            ...config.voice?.realtime,
            enabled: true,
            ...(selection.realtimeStt ? { stt: { provider: 'xopc-cloud' as const, model: selection.realtimeStt } } : {}),
            ...(selection.realtimeTts ? { tts: { provider: 'xopc-cloud' as const, ...selection.realtimeTts } } : {}),
            ...(selection.realtimeOmni ? {
              omni: {
                provider: 'xopc-cloud' as const,
                ...selection.realtimeOmni,
                instructions: config.voice?.realtime?.omni?.instructions
                  ?? 'Keep replies conversational and concise. You cannot execute tools.',
              },
            } : {}),
          },
        },
      } : {}),
    },
  };
}

export async function applyXopcCloudCapabilitySetup(service: {
  currentConfig: Config;
  saveConfig(config: Config): Promise<{ saved: boolean; error?: string }>;
}, options: { enableAvailable?: boolean } = {}): Promise<ApplyXopcCloudCapabilitySetupResult> {
  const source = getModelCatalogStore().getSource('xopc-cloud');
  if (!source) {
    return { configured: false, error: 'XOPC Cloud model catalog is unavailable' };
  }
  const selection = selectXopcCloudCapabilities(source);
  const currentDefaults = new AgentCatalogRepository().getSettings().defaults;
  const nextDefaults = structuredClone(currentDefaults);
  const nextConfig = structuredClone(service.currentConfig);
  const chat = recommendedModel(source, 'chat');
  const vision = recommendedModel(source, 'vision');
  const imageGeneration = recommendedModel(source, 'image-generation');
  const stt = recommendedModel(source, 'stt');
  const tts = recommendedModel(source, 'tts');

  const realtimeStt = recommendedVoiceModel(source, 'transcription.stream');
  const realtimeTts = recommendedVoiceModel(source, 'speech.stream');
  const realtimeOmni = recommendedVoiceModel(source, 'conversation');

  if (chat && currentDefaults.models.chat.primary === DEFAULT_AGENT_MODEL_REF
    && currentDefaults.models.chat.fallbacks.length === 0) {
    nextDefaults.models.chat = { primary: `xopc-cloud/${chat.id}`, fallbacks: [] };
  }
  if (vision && !currentDefaults.models.imageUnderstanding) {
    nextDefaults.models.imageUnderstanding = { primary: `xopc-cloud/${vision.id}`, fallbacks: [] };
  }
  if (imageGeneration && !currentDefaults.models.imageGeneration) {
    nextDefaults.models.imageGeneration = { primary: `xopc-cloud/${imageGeneration.id}`, fallbacks: [], autoProviderFallback: false };
  }
  if (stt && (options.enableAvailable || !nextConfig.tools?.media?.audio)) {
    nextConfig.tools ??= {};
    nextConfig.tools.media ??= {};
    const current = nextConfig.tools.media.audio;
    nextConfig.tools.media.audio = {
      ...current,
      enabled: true,
      provider: 'xopc-cloud',
      fallback: { enabled: false, order: ['xopc-cloud'] },
      models: [{ provider: 'xopc-cloud', model: stt.id, capabilities: ['audio'] }],
      providers: { ...current?.providers, 'xopc-cloud': { ...current?.providers?.['xopc-cloud'], model: stt.id } },
    };
  }
  if (tts && tts.tts?.defaultVoice && (options.enableAvailable || !nextConfig.messages?.tts)) {
    nextConfig.messages ??= {};
    const current = nextConfig.messages.tts;
    nextConfig.messages.tts = {
      ...current,
      enabled: true,
      provider: 'xopc-cloud',
      trigger: current?.trigger ?? 'off',
      fallback: { enabled: false, order: [] },
      maxTextLength: 512,
      timeoutMs: 60_000,
      providers: { ...current?.providers, 'xopc-cloud': { ...current?.providers?.['xopc-cloud'], model: tts.id, voice: tts.tts.defaultVoice } },
    };
  }
  // A missing voice section is a fresh setup; an existing disabled section is a user choice.
  if ((options.enableAvailable || !nextConfig.voice) && (realtimeStt || realtimeTts || realtimeOmni)) {
    nextConfig.voice = ConfigSchema.parse({ voice: { ...nextConfig.voice, realtime: { ...nextConfig.voice?.realtime, enabled: true } } }).voice;
  }
  const realtime = nextConfig.voice?.realtime;
  if (realtime?.enabled) {
    // Existing voice settings are user choices; fill only a missing mode on an enabled setup.
    if (realtimeStt && (options.enableAvailable || !realtime.stt)) realtime.stt = { provider: 'xopc-cloud', model: realtimeStt.id };
    if (realtimeTts && (options.enableAvailable || !realtime.tts)) realtime.tts = { provider: 'xopc-cloud', model: realtimeTts.id, voice: selectedVoice(realtimeTts, 'speech.stream') };
    if (realtimeOmni && (options.enableAvailable || !realtime.omni)) realtime.omni = {
      provider: 'xopc-cloud', model: realtimeOmni.id, voice: selectedVoice(realtimeOmni, 'conversation'),
      instructions: 'Keep replies conversational and concise. You cannot execute tools.',
    };
  }

  if (!chat && !vision && !imageGeneration && !stt && !tts && !realtimeStt && !realtimeTts && !realtimeOmni) {
    return { configured: false, error: 'XOPC Cloud published no usable models', missing: selection.missing };
  }
  nextDefaults.models = completeXopcCloudModelRoutes(nextDefaults.models, source);
  const defaultsUpdate = prepareUpdateGlobalDefaults({ defaults: nextDefaults });
  if (defaultsUpdate.ok === false) return { configured: false, error: defaultsUpdate.error };
  const saved = await service.saveConfig(nextConfig);
  if (!saved.saved) {
    return { configured: false, error: saved.error ?? 'Failed to save XOPC Cloud capability configuration' };
  }
  new AgentCatalogService().updateDefaults(defaultsUpdate.data.defaults);
  return {
    configured: true,
    missing: selection.missing,
    selection: {
      ...(chat ? { chat: chat.id } : {}),
      ...(vision ? { vision: vision.id } : {}),
      ...(imageGeneration ? { imageGeneration: imageGeneration.id } : {}),
      ...(stt ? { stt: stt.id } : {}),
      ...(tts ? { tts: tts.id, ttsVoice: tts.tts?.defaultVoice } : {}),
      ...(realtimeStt ? { realtimeStt: realtimeStt.id } : {}),
      ...(realtimeTts ? { realtimeTts: { model: realtimeTts.id, voice: selectedVoice(realtimeTts, 'speech.stream') } } : {}),
      ...(realtimeOmni ? { realtimeOmni: { model: realtimeOmni.id, voice: selectedVoice(realtimeOmni, 'conversation') } } : {}),
    },
  };
}

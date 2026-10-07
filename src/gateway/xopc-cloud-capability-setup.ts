import type { VoiceModeCapability } from '@xopcai/realtime-protocol/voice';

import type { Config } from '../config/schema.js';
import type { AgentDefaults } from '../agent-config/index.js';
import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { AgentCatalogService } from '../agent-catalog/service.js';
import type { CatalogModel, CatalogSource } from '../providers/model-catalog-store.js';
import { getModelCatalogStore } from '../providers/model-catalog-store.js';
import { compareCatalogModels } from '../providers/model-catalog-ranking.js';
import { getAvailableModels } from '../providers/index.js';
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
  if (model.availability !== 'available') return false;
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
      && (mode === 'transcription.stream' || Boolean(model.voice.voices.length)))
    .sort((left, right) => compareCatalogModels(left, right, recommendation))[0];
}

function selectedVoice(model: CatalogModel): string {
  const voices = model.voice?.voices ?? [];
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
      ...(realtimeTts ? { realtimeTts: { model: realtimeTts.id, voice: selectedVoice(realtimeTts) } } : {}),
      ...(realtimeOmni ? { realtimeOmni: { model: realtimeOmni.id, voice: selectedVoice(realtimeOmni) } } : {}),
    },
  };
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
      models: {
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
      },
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
}): Promise<ApplyXopcCloudCapabilitySetupResult> {
  const source = getModelCatalogStore().getSource('xopc-cloud');
  if (!source) {
    return { configured: false, error: 'XOPC Cloud model catalog is unavailable' };
  }
  const selection = selectXopcCloudCapabilities(source);
  const currentDefaults = new AgentCatalogRepository().getSettings().defaults;
  const availableModels = new Set((await getAvailableModels()).map((model) => `${model.provider}/${model.id}`));
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

  if (chat && !availableModels.has(currentDefaults.models.chat.primary)) {
    nextDefaults.models.chat = { primary: `xopc-cloud/${chat.id}`, fallbacks: [] };
  }
  if (vision && !currentDefaults.models.imageUnderstanding) {
    nextDefaults.models.imageUnderstanding = { primary: `xopc-cloud/${vision.id}`, fallbacks: [] };
  }
  if (imageGeneration && !currentDefaults.models.imageGeneration) {
    nextDefaults.models.imageGeneration = { primary: `xopc-cloud/${imageGeneration.id}`, fallbacks: [], autoProviderFallback: false };
  }
  if (stt && !nextConfig.tools?.media?.audio) {
    nextConfig.tools ??= {};
    nextConfig.tools.media ??= {};
    nextConfig.tools.media.audio = {
      enabled: true,
      provider: 'xopc-cloud',
      fallback: { enabled: false, order: ['xopc-cloud'] },
      providers: { 'xopc-cloud': { model: stt.id } },
    };
  }
  if (tts && tts.tts?.defaultVoice && !nextConfig.messages?.tts) {
    nextConfig.messages ??= {};
    nextConfig.messages.tts = {
      enabled: true,
      provider: 'xopc-cloud',
      trigger: 'off',
      maxTextLength: 512,
      timeoutMs: 60_000,
      providers: { 'xopc-cloud': { model: tts.id, voice: tts.tts.defaultVoice } },
    };
  }
  const realtime = nextConfig.voice?.realtime;
  if (realtime?.enabled) {
    // Existing voice settings are user choices; fill only a missing mode on an enabled setup.
    if (realtimeStt && !realtime.stt) realtime.stt = { provider: 'xopc-cloud', model: realtimeStt.id };
    if (realtimeTts && !realtime.tts) realtime.tts = { provider: 'xopc-cloud', model: realtimeTts.id, voice: selectedVoice(realtimeTts) };
    if (realtimeOmni && !realtime.omni) realtime.omni = {
      provider: 'xopc-cloud', model: realtimeOmni.id, voice: selectedVoice(realtimeOmni),
      instructions: 'Keep replies conversational and concise. You cannot execute tools.',
    };
  }

  if (!chat && !vision && !imageGeneration && !stt && !tts && !realtimeStt && !realtimeTts && !realtimeOmni) {
    return { configured: false, error: 'XOPC Cloud published no usable models', missing: selection.missing };
  }
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
      ...(realtimeTts ? { realtimeTts: { model: realtimeTts.id, voice: selectedVoice(realtimeTts) } } : {}),
      ...(realtimeOmni ? { realtimeOmni: { model: realtimeOmni.id, voice: selectedVoice(realtimeOmni) } } : {}),
    },
  };
}

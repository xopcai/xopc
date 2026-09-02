import type { Config } from '../config/schema.js';
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
}

export type PrepareXopcCloudCapabilitySetupResult =
  | { ok: true; config: Config; selection: XopcCloudCapabilitySelection }
  | { ok: false; error: string; missing: CloudCapability[] };

export type ApplyXopcCloudCapabilitySetupResult =
  | { configured: true; selection: XopcCloudCapabilitySelection }
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

export function selectXopcCloudCapabilities(
  source: CatalogSource,
): { selection?: XopcCloudCapabilitySelection; missing: CloudCapability[] } {
  const chat = recommendedModel(source, 'chat');
  const vision = recommendedModel(source, 'vision');
  const imageGeneration = recommendedModel(source, 'image-generation');
  const stt = recommendedModel(source, 'stt');
  const tts = recommendedModel(source, 'tts');
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
  const currentModels = config.agents.defaults.models;
  const defaultsUpdate = prepareUpdateGlobalDefaults(config, {
    defaults: {
      ...config.agents.defaults,
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

  const withDefaults = defaultsUpdate.data.nextConfig;
  const currentStt = withDefaults.tools?.media?.audio;
  const currentTts = withDefaults.messages?.tts;
  return {
    ok: true,
    selection,
    config: {
      ...withDefaults,
      tools: {
        ...withDefaults.tools,
        media: {
          ...withDefaults.tools?.media,
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
        ...withDefaults.messages,
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
  const prepared = prepareXopcCloudCapabilitySetup(service.currentConfig, source);
  if (prepared.ok === false) {
    return { configured: false, error: prepared.error, missing: prepared.missing };
  }
  const saved = await service.saveConfig(prepared.config);
  if (!saved.saved) {
    return { configured: false, error: saved.error ?? 'Failed to save XOPC Cloud capability configuration' };
  }
  return { configured: true, selection: prepared.selection };
}

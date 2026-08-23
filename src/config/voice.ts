import { listVoiceProviderMetadata } from '../voice/metadata/index.js';
import { getModelCatalogStore } from '../providers/model-catalog-store.js';

export interface VoiceModel {
  id: string;
  name: string;
  description?: string;
  tts?: {
    speed: boolean;
    instructions: boolean;
    outputFormats: string[];
    defaultVoice?: string;
  };
}

export interface VoiceModelsConfig {
  stt: Record<string, VoiceModel[]>;
  tts: Record<string, VoiceModel[]>;
  ttsVoices: Record<string, VoiceModel[]>;
}

function toVoiceModels(values: VoiceModel[] | undefined): VoiceModel[] {
  return (values ?? []).map((value) => ({
    id: value.id,
    name: value.name,
    ...(value.description ? { description: value.description } : {}),
  }));
}

export function getVoiceModelsConfig(): VoiceModelsConfig {
  const config: VoiceModelsConfig = { stt: {}, tts: {}, ttsVoices: {} };
  for (const metadata of listVoiceProviderMetadata()) {
    if (metadata.capability === 'stt') {
      config.stt[metadata.id] = toVoiceModels(metadata.models);
      continue;
    }
    config.tts[metadata.id] = toVoiceModels(metadata.models);
    config.ttsVoices[metadata.id] = toVoiceModels(metadata.voices);
  }

  const cloudModels = getModelCatalogStore().getSource('xopc-cloud')?.models ?? [];
  config.stt['xopc-cloud'] = cloudModels
    .filter((model) => model.availability === 'available' && model.kind === 'stt')
    .map((model) => ({ id: model.id, name: model.name }));
  config.tts['xopc-cloud'] = cloudModels
    .filter((model) => model.availability === 'available' && model.kind === 'tts')
    .map((model) => ({
      id: model.id,
      name: model.name,
      ...(model.tts ? {
        tts: {
          speed: model.tts.speed,
          instructions: model.tts.instructions,
          outputFormats: [...model.tts.outputFormats],
          ...(model.tts.defaultVoice ? { defaultVoice: model.tts.defaultVoice } : {}),
        },
      } : {}),
    }));
  return config;
}

export function getTTSProviders(): Array<{ id: string; name: string; description?: string }> {
  return listVoiceProviderMetadata('tts').map((metadata) => ({
    id: metadata.id,
    name: metadata.displayName,
    ...(metadata.description ? { description: metadata.description } : {}),
  }));
}

export function getTTSTriggerModes(): Array<{ id: string; name: string; description: string }> {
  return [
    { id: 'off', name: 'Disabled', description: 'TTS is completely disabled' },
    { id: 'always', name: 'Always', description: 'Apply TTS to all messages' },
    { id: 'inbound', name: 'Inbound Audio', description: 'Only when user sends voice message' },
    { id: 'tagged', name: 'Tagged', description: 'Only when [[tts]] directive is used' },
  ];
}

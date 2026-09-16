import type { VoiceModeCapability } from '@xopcai/realtime-protocol/voice';
import { getModelCatalogStore } from '../providers/model-catalog-store.js';

export function platformVoiceModels(mode: VoiceModeCapability) {
  return (getModelCatalogStore().getSource('xopc-cloud')?.models ?? [])
    .filter(model => model.availability === 'available' && model.voice?.modes.includes(mode));
}
export function requirePlatformVoiceModel(id: string, mode: VoiceModeCapability) {
  const model = platformVoiceModels(mode).find(model => model.id === id);
  if (!model?.voice) throw new Error(`Published voice model is unavailable for ${mode}: ${id}`);
  return { ...model, voice: model.voice };
}

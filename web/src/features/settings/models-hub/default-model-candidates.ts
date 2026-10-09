import type { ConfiguredModel } from '@/features/chat/api/registry-api';

export interface DefaultModelTarget {
  providerId: string;
  modelIds?: string[];
}

export function defaultModelCandidates(models: ConfiguredModel[], target: DefaultModelTarget) {
  return models.filter(model => model.id.startsWith(`${target.providerId}/`)
    && !model.computerUse
    && (!target.modelIds || target.modelIds.includes(model.id.slice(target.providerId.length + 1))));
}

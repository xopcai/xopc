import type { Config } from '../config/schema.js';
import {
  getAgentDefaultImageGenerationModelConfig,
  getAgentDefaultImageModelConfig,
} from '../config/schema.js';
import {
  getImageGenerationProvider,
  listImageGenerationProvidersSummary,
} from '../agent/image/generation/runtime.js';
import { getAllProviders, getModelsByProvider, isProviderConfigured } from '../providers/index.js';

export type ImageProviderCapability = {
  provider: string;
  configured: boolean;
  models: Array<{
    id: string;
    name: string;
    ref: string;
  }>;
};

export type CurrentImageModelCapabilities = {
  imageModel: string | null;
  imageModelFallbacks: string[];
  imageGenerationModel: string | null;
  imageGenerationModelFallbacks: string[];
  imageGenerationModelTimeoutMs: number | null;
  imageGenerationModelAutoProviderFallback: boolean;
  mediaMaxMb: number | null;
};

export function resolveCurrentImageModelCapabilities(config: Config): CurrentImageModelCapabilities {
  const imageModel = getAgentDefaultImageModelConfig(config);
  const imageGenerationModel = getAgentDefaultImageGenerationModelConfig(config);
  return {
    imageModel: imageModel?.primary?.trim() || null,
    imageModelFallbacks: imageModel?.fallbacks ?? [],
    imageGenerationModel: imageGenerationModel?.primary?.trim() || null,
    imageGenerationModelFallbacks: imageGenerationModel?.fallbacks ?? [],
    imageGenerationModelTimeoutMs: imageGenerationModel?.timeoutMs ?? null,
    imageGenerationModelAutoProviderFallback: imageGenerationModel?.autoProviderFallback === true,
    mediaMaxMb: null,
  };
}

export async function resolveImageGenerationCapabilities(config: Config): Promise<ImageProviderCapability[]> {
  const results: ImageProviderCapability[] = [];
  const summaries = listImageGenerationProvidersSummary();

  for (const s of summaries) {
    const provider = getImageGenerationProvider(s.id, config);
    let configured = false;
    try {
      configured = provider?.isConfigured?.({ cfg: config }) === true;
    } catch {
      configured = false;
    }
    if (!configured) {
      continue;
    }
    results.push({
      provider: s.id,
      configured,
      models: (s.models ?? []).map((id) => ({
        id,
        name: id,
        ref: `${s.id}/${id}`,
      })),
    });
  }

  return results;
}

export async function resolveImageUnderstandingCapabilities(_config: Config): Promise<ImageProviderCapability[]> {
  const results: ImageProviderCapability[] = [];

  for (const providerId of getAllProviders()) {
    const models = getModelsByProvider(providerId).filter((model) => model.input?.includes('image'));
    if (models.length === 0) {
      continue;
    }
    const configured = await isProviderConfigured(providerId);
    if (!configured) {
      continue;
    }
    results.push({
      provider: providerId,
      configured,
      models: models.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        ref: `${providerId}/${m.id}`,
      })),
    });
  }

  return results;
}

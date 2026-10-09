import { getModelCatalogStore } from '../../../../providers/model-catalog-store.js';
import { compareCatalogModels } from '../../../../providers/model-catalog-ranking.js';
import { getProviderAuthService } from '../../../../providers/provider-auth-service.js';
import { resolveXopcModelRouterUrl } from '../../../../providers/xopc-cloud-config.js';
import { createOpenAiImagesProvider } from '../openai-images-provider.js';
import type {
  ImageGenerationProvider,
  ImageGenerationProviderCapabilities,
} from '../types.js';

export function buildXopcCloudImageGenerationProvider(): ImageGenerationProvider | undefined {
  const source = getModelCatalogStore().getSource('xopc-cloud');
  const models = source?.models.filter((model) =>
    model.availability === 'available'
    && model.kind === 'image'
    && model.operations.includes('images.generate') && Boolean(model.imageGeneration))
    .sort((left, right) => compareCatalogModels(
      left,
      right,
      source.recommended?.['image-generation'],
    )) ?? [];
  if (models.length === 0) return undefined;

  const modelCapabilities = Object.fromEntries(models.map((model) => [
    model.id,
    model.imageGeneration!,
  ])) as Record<string, ImageGenerationProviderCapabilities>;
  const defaultModel = models[0]!.id;
  const baseUrl = source?.baseUrl ?? resolveXopcModelRouterUrl();
  const executors = new Map(models.map((model) => [model.id, createOpenAiImagesProvider({
    id: 'xopc-cloud', label: 'XOPC Model Service', defaultModel: model.id, models: [model.id], defaultTimeoutMs: 600_000,
    capabilities: modelCapabilities[model.id]!,
    isConfigured: () => true,
    resolveApiKey: (request) => getProviderAuthService().resolveApiKey('xopc-cloud', request.signal),
    resolveEndpoint: () => ({ baseUrl }),
    ...(model.imageGeneration?.geometry?.sizes?.[0] ? { defaultSize: model.imageGeneration.geometry!.sizes![0] } : {}),
  })]));
  return {
    id: 'xopc-cloud',
    label: 'XOPC Model Service',
    credentialMode: 'oauth',
    defaultModel,
    models: models.map((model) => model.id),
    capabilities: modelCapabilities[defaultModel]!,
    modelCapabilities,
    isConfigured: () => true,
    async generateImage(request) {
      const executor = executors.get(request.model);
      if (!executor) throw new Error(`Image model is not available from XOPC Model Service: ${request.model}`);
      return executor.generateImage(request);
    },
  };
}

import { getModelCatalogStore, type CatalogModel } from '../../../../providers/model-catalog-store.js';
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
    && model.operations.includes('images.generate')) ?? [];
  if (models.length === 0) return undefined;

  const modelCapabilities = Object.fromEntries(models.map((model) => [
    model.id,
    toProviderCapabilities(model),
  ])) as Record<string, ImageGenerationProviderCapabilities>;
  const defaultModel = models[0]!.id;
  const baseUrl = source?.baseUrl ?? resolveXopcModelRouterUrl();
  const executors = new Map(models.map((model) => [model.id, createOpenAiImagesProvider({
    id: 'xopc-cloud', label: 'XOPC Model Service', defaultModel: model.id, models: [model.id],
    capabilities: modelCapabilities[model.id]!,
    isConfigured: () => true,
    resolveApiKey: (request) => getProviderAuthService().resolveApiKey('xopc-cloud', request.signal),
    resolveEndpoint: () => ({ baseUrl }),
    ...(model.imageGeneration?.sizes[0] ? { defaultSize: model.imageGeneration.sizes[0] } : {}),
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
      const geometry = modelCapabilities[request.model]?.geometry;
      const size = request.size
        ?? (request.aspectRatio && geometry?.aspectRatios?.includes(request.aspectRatio) ? request.aspectRatio : undefined)
        ?? (request.resolution && geometry?.resolutions?.includes(request.resolution) ? request.resolution : undefined);
      return executor.generateImage({ ...request, ...(size ? { size } : {}) });
    },
  };
}

function toProviderCapabilities(model: CatalogModel): ImageGenerationProviderCapabilities {
  const image = model.imageGeneration;
  return {
    generate: {
      maxCount: image?.maxCount ?? 1,
      supportsSize: Boolean(image?.sizes.length),
      supportsAspectRatio: Boolean(image?.aspectRatios?.length),
    },
    edit: {
      enabled: model.operations.includes('images.edit'),
      maxInputImages: image?.maxInputImages ?? 0,
      supportsSize: Boolean(image?.sizes.length),
      supportsAspectRatio: Boolean(image?.aspectRatios?.length),
    },
    geometry: { sizes: image?.sizes ?? [], aspectRatios: image?.aspectRatios ?? [] },
    output: {
      qualities: image?.qualities ?? [],
      formats: image?.formats ?? [],
      backgrounds: image?.backgrounds ?? [],
    },
  };
}

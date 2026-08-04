import type {
  ImageGenerationProviderConfig,
  ProviderConfig,
} from '../../../config/models-json.js';
import {
  isProviderApiKeyConfigured,
  resolveAuthProfileForProvider,
} from '../../../providers/auth-runtime/index.js';
import { createOpenAiImagesProvider } from './openai-images-provider.js';
import type {
  ImageGenerationProvider,
  ImageGenerationProviderCapabilities,
} from './types.js';

export function buildCustomOpenAiImagesProvider(params: {
  providerId: string;
  provider: ProviderConfig;
  imageGeneration: ImageGenerationProviderConfig;
}): ImageGenerationProvider {
  const { providerId, provider, imageGeneration } = params;
  if (!provider.baseUrl) {
    throw new Error(`Custom image provider "${providerId}" requires baseUrl.`);
  }

  const models = imageGeneration.models.map((model) => model.id);
  const modelCapabilities = Object.fromEntries(
    imageGeneration.models.map((model) => [model.id, model.capabilities]),
  ) as Record<string, ImageGenerationProviderCapabilities>;
  const defaultCapabilities = modelCapabilities[imageGeneration.defaultModel];
  if (!defaultCapabilities) {
    throw new Error(
      `Custom image provider "${providerId}" default model is not in its model catalog.`,
    );
  }

  const auth = imageGeneration.auth;
  const isConfigured: ImageGenerationProvider['isConfigured'] = (ctx) =>
    auth.type === 'none'
    || isProviderApiKeyConfigured({
      providerId,
      cfg: ctx.cfg,
      agentId: ctx.agentId,
    });
  const executors = new Map(
    imageGeneration.models.map((model) => {
      const executor = createOpenAiImagesProvider({
        id: providerId,
        label: imageGeneration.name,
        defaultModel: model.id,
        models: [model.id],
        capabilities: model.capabilities,
        isConfigured,
        resolveApiKey: (req) => {
          if (auth.type === 'none') return null;
          return resolveAuthProfileForProvider({
            providerId,
            cfg: req.cfg,
            agentId: req.agentId,
            store: req.authStore,
          }).apiKey;
        },
        resolveEndpoint: () => ({
          baseUrl: provider.baseUrl!,
          headers: provider.headers,
          generationsPath: imageGeneration.paths?.generations,
          editsPath: imageGeneration.paths?.edits,
          authorization:
            auth.type === 'none'
              ? { kind: 'none' }
              : auth.type === 'header'
                ? { kind: 'header', headerName: auth.headerName }
                : { kind: 'bearer' },
          privateNetworkPolicy: imageGeneration.network
            ? { allowPrivate: true, allowHosts: imageGeneration.network.allowedHosts }
            : {},
        }),
        defaultCount: model.defaults?.count,
        defaultSize: model.defaults?.size,
      });
      return [model.id, { executor, outputFormat: model.defaults?.outputFormat }] as const;
    }),
  );

  return {
    id: providerId,
    label: imageGeneration.name,
    source: 'custom',
    credentialMode: auth.type === 'none' ? 'none' : 'api-key',
    documentationUrl: imageGeneration.documentationUrl,
    apiKeyUrl: imageGeneration.apiKeyUrl,
    defaultModel: imageGeneration.defaultModel,
    models,
    capabilities: defaultCapabilities,
    modelCapabilities,
    isConfigured,
    async generateImage(req) {
      const selected = executors.get(req.model);
      if (!selected) {
        throw new Error(`Image model is not configured for ${providerId}: ${req.model}`);
      }
      return selected.executor.generateImage({
        ...req,
        outputFormat: req.outputFormat ?? selected.outputFormat,
      });
    },
  };
}

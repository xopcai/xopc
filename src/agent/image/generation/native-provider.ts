import { executeImageProvider, getImageProviderSpec } from '@xopcai/image-providers';

import { isProviderApiKeyConfigured, resolveApiKeyForProvider } from '../../../providers/auth-runtime/index.js';
import { fetchWithTimeoutGuarded, privateNetworkPolicyToSsrfGuardOptions, resolveProviderHttpRequestConfig } from '../../../media-shared/http/index.js';
import type { ImageGenerationProvider } from './types.js';

export function buildNativeImageProvider(providerId: string): ImageGenerationProvider {
  const spec = getImageProviderSpec(providerId);
  const modelCapabilities = Object.fromEntries(spec.models.map((model) => [model.id, model.capabilities]));
  return {
    id: spec.id, label: spec.name, documentationUrl: spec.documentationUrl, apiKeyUrl: spec.apiKeyUrl,
    defaultModel: spec.models[0]!.id, models: spec.models.map((model) => model.id),
    capabilities: spec.models[0]!.capabilities, modelCapabilities,
    configFields: [
      ...(spec.regions ? [{ key: 'region' as const, label: 'Region', type: 'select' as const, required: true,
        options: [{ value: 'cn', label: 'China' }, { value: 'intl', label: 'International' }] }] : []),
      { key: 'baseUrl', label: 'Base URL', type: 'url', placeholder: spec.baseUrl },
    ],
    isConfigured: (ctx) => isProviderApiKeyConfigured({ providerId, cfg: ctx.cfg, agentId: ctx.agentId })
      && (!spec.regions || Boolean(ctx.cfg?.providers?.[providerId]?.region)),
    async generateImage(req) {
      const apiKey = resolveApiKeyForProvider({ providerId, cfg: req.cfg, agentId: req.agentId, store: req.authStore });
      if (!apiKey) throw new Error(`${spec.name} API key missing`);
      const settings = req.cfg?.providers?.[providerId];
      if (settings?.azure) throw new Error('Configure Azure images as an explicit custom image provider');
      const baseUrl = settings?.baseUrl ?? (spec.regions ? spec.regions[settings?.region!] : spec.baseUrl);
      if (!baseUrl) throw new Error(`${spec.name} requires region or baseUrl`);
      const http = resolveProviderHttpRequestConfig({ providerId, cfg: req.cfg, fallbackTimeoutMs: spec.timeoutMs });
      const timeoutMs = req.timeoutMs ?? http.timeoutMs ?? spec.timeoutMs;
      const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(req.signal ? [req.signal] : [])]);
      const result = await executeImageProvider({
        providerId, baseUrl, apiKey, signal,
        fetchImpl: ((url, init) => {
          const headers = new Headers(new URL(String(url)).origin === new URL(baseUrl).origin ? http.headers : undefined);
          new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
          return fetchWithTimeoutGuarded(String(url), { label: spec.name, timeoutMs, signal,
            init: { ...init, headers, redirect: 'error' }, ...privateNetworkPolicyToSsrfGuardOptions() });
        }) as typeof fetch,
        request: { model: req.model, prompt: req.prompt, count: req.count, size: req.size,
          aspectRatio: req.aspectRatio, resolution: req.resolution, quality: req.quality,
          outputFormat: req.outputFormat, background: req.background ?? req.providerOptions?.openai?.background,
          openai: req.providerOptions?.openai,
          inputImages: req.inputImages?.map((image, index) => ({ blob: new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }), fileName: image.fileName ?? `input-${index}.png` })),
        },
      });
      return { model: req.model, images: result.images.map((image) => ({ buffer: Buffer.from(image.bytes), mimeType: image.mimeType })),
        metadata: { requestId: result.requestId, usage: result.usage } };
    },
  };
}

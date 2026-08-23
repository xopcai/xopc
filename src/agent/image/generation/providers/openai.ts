/**
 * Built-in OpenAI image-generation provider.
 *
 * Supports:
 *   - **Azure OpenAI** routing (when `cfg.providers.openai.azure.{resource,
 *     deployment, apiVersion}` is set, or env `AZURE_OPENAI_*`): swaps base
 *     URL + uses `api-key` header instead of `Authorization: Bearer`.
 *   - **OAuth** support (Codex / future): when the active auth profile is
 *     `mode: 'oauth'`, the OAuth access token is sent as a Bearer token.
 *     Refresh is NOT performed here — vendors call
 *     `refreshOAuthProfile` + `store.save` ahead of time.
 */
import {
  isProviderApiKeyConfigured,
  resolveAuthProfileForProvider,
} from '../../../../providers/auth-runtime/index.js';
import { createOpenAiImagesProvider } from '../openai-images-provider.js';
import type { OpenAiImagesEndpointResolution } from '../openai-images-provider.js';
import type {
  ImageGenerationProvider,
  ImageGenerationProviderCapabilities,
  ImageGenerationRequest,
} from '../types.js';

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** Image models exposed by the OpenAI Images API. */
export const OPENAI_IMAGE_MODELS: readonly string[] = ['gpt-image-2'];
export const OPENAI_DEFAULT_IMAGE_MODEL = OPENAI_IMAGE_MODELS[0]!;

const OPENAI_CAPABILITIES: ImageGenerationProviderCapabilities = {
  generate: { maxCount: 4, supportsSize: true },
  edit: { enabled: true, maxInputImages: 1, supportsSize: true },
  geometry: { sizes: ['1024x1024', '1024x1536', '1536x1024'] },
  output: {
    qualities: ['low', 'medium', 'high', 'auto'],
    formats: ['png', 'jpeg', 'webp'],
    backgrounds: ['transparent', 'opaque', 'auto'],
  },
};

interface AzureSettings {
  resource: string;
  deployment: string;
  apiVersion: string;
}

function resolveAzureSettings(req: ImageGenerationRequest): AzureSettings | undefined {
  const cfg = req.cfg as unknown as
    | { providers?: { openai?: { azure?: { resource?: unknown; deployment?: unknown; apiVersion?: unknown } } } }
    | undefined;
  const fromCfg = cfg?.providers?.openai?.azure;
  const resource = pickString(fromCfg?.resource) ?? pickEnv('AZURE_OPENAI_RESOURCE');
  const deployment =
    pickString(fromCfg?.deployment) ?? pickEnv('AZURE_OPENAI_DEPLOYMENT') ?? req.model;
  const apiVersion =
    pickString(fromCfg?.apiVersion) ?? pickEnv('AZURE_OPENAI_API_VERSION') ?? '2024-08-01-preview';
  if (!resource || !deployment) return undefined;
  return { resource, deployment, apiVersion };
}

function pickString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

function pickEnv(name: string): string | undefined {
  return pickString(process.env[name]);
}

function resolveOpenAiBaseUrl(req: ImageGenerationRequest): string {
  const cfg = req.cfg as unknown as { providers?: Record<string, { baseUrl?: unknown }> } | undefined;
  const fromCfg = pickString(cfg?.providers?.openai?.baseUrl);
  if (fromCfg) return fromCfg.replace(/\/+$/, '');
  const fromEnv = pickEnv('OPENAI_BASE_URL');
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return OPENAI_DEFAULT_BASE_URL;
}

function buildAzureEndpoint(azure: AzureSettings): OpenAiImagesEndpointResolution {
  const baseUrl = `https://${azure.resource}.openai.azure.com/openai`;
  const query = `?api-version=${encodeURIComponent(azure.apiVersion)}`;
  return {
    baseUrl,
    generationsPath: `/deployments/${encodeURIComponent(azure.deployment)}/images/generations${query}`,
    editsPath: `/deployments/${encodeURIComponent(azure.deployment)}/images/edits${query}`,
    authorization: { kind: 'header', headerName: 'api-key' },
  };
}

export function buildOpenAIImageGenerationProvider(): ImageGenerationProvider {
  return {
    ...createOpenAiImagesProvider({
      id: 'openai',
      label: 'OpenAI',
      defaultModel: OPENAI_DEFAULT_IMAGE_MODEL,
      models: [...OPENAI_IMAGE_MODELS],
      capabilities: OPENAI_CAPABILITIES,
      isConfigured: (ctx) =>
        isProviderApiKeyConfigured({
          providerId: 'openai',
          cfg: ctx.cfg,
          agentId: ctx.agentId,
        }),
      resolveApiKey: (req) => {
        const auth = resolveAuthProfileForProvider({
          providerId: 'openai',
          cfg: req.cfg,
          agentId: req.agentId,
          store: req.authStore,
        });
        return auth.apiKey ?? null;
      },
      resolveEndpoint: (req) => {
        // 1. Azure routing: explicit `cfg.providers.openai.azure.*` or
        //    AZURE_OPENAI_* env wins over the public api.openai.com endpoint.
        const azure = resolveAzureSettings(req);
        if (azure) return buildAzureEndpoint(azure);
        // 2. OAuth (Codex / future) — same wire format as api-key, the access
        //    token is used as a Bearer token. The default factory branch
        //    (kind: 'bearer') already handles this.
        return { baseUrl: resolveOpenAiBaseUrl(req) };
      },
      defaultTimeoutMs: 120_000,
    }),
    documentationUrl: 'https://platform.openai.com/docs/guides/image-generation',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    configFields: [{
      key: 'baseUrl',
      label: 'Base URL',
      type: 'url',
      placeholder: 'https://api.openai.com/v1',
    }],
  };
}

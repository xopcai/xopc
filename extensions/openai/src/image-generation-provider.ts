/**
 * Bundled OpenAI image-generation provider.
 *
 * Migrated from src/agent/image/generation/openai-generate.ts as part of the
 * Step 3 plugin-isation. Step 4 adds:
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
} from '@xopcai/xopc/providers/auth-runtime/index.js';
import { OPENAI_DEFAULT_IMAGE_MODEL } from '@xopcai/xopc/agent/image/generation/constants.js';
import { createOpenAiCompatibleImageProvider } from '@xopcai/xopc/agent/image/generation/openai-compatible-image-provider.js';
import type { OpenAiCompatibleEndpointResolution } from '@xopcai/xopc/agent/image/generation/openai-compatible-image-provider.js';
import type {
  ImageGenerationProvider,
  ImageGenerationProviderCapabilities,
  ImageGenerationRequest,
} from '@xopcai/xopc/agent/image/generation/types.js';

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

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

function buildAzureEndpoint(azure: AzureSettings): OpenAiCompatibleEndpointResolution {
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
  return createOpenAiCompatibleImageProvider({
    id: 'openai',
    label: 'OpenAI',
    defaultModel: OPENAI_DEFAULT_IMAGE_MODEL,
    models: [OPENAI_DEFAULT_IMAGE_MODEL, 'dall-e-3', 'dall-e-2'],
    capabilities: OPENAI_CAPABILITIES,
    isConfigured: (ctx) =>
      isProviderApiKeyConfigured({ providerId: 'openai', cfg: ctx.cfg }),
    resolveApiKey: (req) => {
      const auth = resolveAuthProfileForProvider({
        providerId: 'openai',
        cfg: req.cfg,
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
    buildGenerateRequestBody: (req, base) => {
      // dall-e-2 / dall-e-3 have stricter validation. Strip params they reject.
      const m = (req.model || '').toLowerCase();
      if (m === 'dall-e-2' || m === 'dall-e-3') {
        const cleaned: Record<string, unknown> = { ...base };
        delete cleaned.output_format;
        delete cleaned.background;
        delete cleaned.output_compression;
        delete cleaned.moderation;
        if (m === 'dall-e-3' && (cleaned.n === undefined || Number(cleaned.n) > 1)) {
          // dall-e-3 only accepts n=1.
          cleaned.n = 1;
        }
        if (m === 'dall-e-2' && cleaned.quality !== undefined) {
          // dall-e-2 has no quality dimension.
          delete cleaned.quality;
        }
        return cleaned;
      }
      return base;
    },
  });
}

import { ImageProviderError } from '@xopcai/image-providers';

import type { Config } from '../../../config/schema.js';
import { PROVIDER_ENV_MAP } from '../../../providers/env-keys.js';
import { createLogger } from '../../../utils/logger.js';
import {
  buildNoCapabilityModelConfiguredMessage,
  recordCapabilityCandidateFailure,
  resolveCapabilityModelCandidates,
  throwCapabilityGenerationFailure,
  type CapabilityProviderCandidate,
} from '../../media-generation/index.js';
import { describeFailoverError, isFailoverError, type FallbackAttempt } from '../../failover-error.js';
import { parseImageGenerationModelRef } from './model-ref.js';
import { validateImageGenerationRequest } from './validation.js';
import {
  getImageGenerationProvider,
  listImageGenerationProviders,
  listImageGenerationProvidersSummary as listProvidersSummaryFromRegistry,
  type ImageGenerationProvider,
  type ImageGenerationProviderSummary,
} from './provider-registry.js';
import type {
  ImageGenerationProviderCapabilities,
  ImageGenerationRequest,
  ImageGenerationSourceImage,
} from './types.js';


export type {
  GenerateImageParams,
  GenerateImageRuntimeResult,
  ImageGenerationRuntimeDeps,
} from './runtime-types.js';

import type {
  GenerateImageParams,
  GenerateImageRuntimeResult,
  ImageGenerationRuntimeDeps,
} from './runtime-types.js';

const log = createLogger('ImageGen');

/**
 * Generate one or more images, walking the candidate model list with
 * structured failover. See {@link GenerateImageParams} / {@link GenerateImageRuntimeResult}.
 */
export async function generateImage(
  params: GenerateImageParams,
  deps: ImageGenerationRuntimeDeps = {},
): Promise<GenerateImageRuntimeResult> {
  const listProviders = (cfg?: Config) =>
    (deps.listProviders ?? listImageGenerationProviders)(cfg);
  const getProvider = (id: string, cfg?: Config) =>
    (deps.getProvider ?? getImageGenerationProvider)(id, cfg);

  const candidates = resolveCapabilityModelCandidates({
    cfg: params.cfg,
    modelConfig: params.modelConfig,
    modelOverride: params.modelOverride,
    parseModelRef: parseImageGenerationModelRef,
    agentId: params.agentId,
    agentDir: params.agentDir,
    listProviders: (cfg) => listProviders(cfg).map(toCapabilityCandidate),
    autoProviderFallback: params.autoProviderFallback,
  });

  if (candidates.length === 0) {
    throw new Error(buildNoImageGenerationModelConfiguredMessage(params.cfg, deps));
  }

  params = { ...params, signal: AbortSignal.any([AbortSignal.timeout(params.timeoutMs ?? 600_000), ...(params.signal ? [params.signal] : [])]) };
  const attempts: FallbackAttempt[] = [];
  let lastError: unknown;

  for (const candidate of candidates.slice(0, 3)) {
    const startedAt = Date.now();
    const provider = getProvider(candidate.provider, params.cfg);
    if (!provider) {
      const errorMessage = `Image generation provider not registered: ${candidate.provider}`;
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: errorMessage,
        reason: 'config',
      });
      lastError = new Error(errorMessage);
      log.warn(
        { provider: candidate.provider, model: candidate.model, phase: 'candidate_skipped' },
        `image-generation candidate skipped: ${errorMessage}`,
      );
      continue;
    }

    try {
      if (!provider.models.includes(candidate.model)) throw new ImageProviderError(`Unsupported image model: ${candidate.model}`, 400);
      const modelCapabilities = provider.modelCapabilities?.[candidate.model];
      const capabilityProvider = modelCapabilities
        ? { ...provider, capabilities: modelCapabilities }
        : provider;
      validateImageGenerationRequest({
        provider: capabilityProvider,
        size: params.size,
        count: params.count,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        quality: params.quality,
        outputFormat: params.outputFormat,
        background: params.background,
        inputImages: params.inputImages,
      });

      const request = buildProviderRequest({
        provider,
        candidate,
        params,
      });

      log.debug(
        {
          provider: candidate.provider,
          model: candidate.model,
          phase: 'provider_invoked',
        },
        `image-generation provider invoked: ${candidate.provider}/${candidate.model}`,
      );

      const result = await provider.generateImage(request);
      if (!result.images?.length) {
        throw new Error('Image generation provider returned no images.');
      }

      return {
        images: result.images,
        provider: candidate.provider,
        model: result.model ?? candidate.model,
        attempts,
        metadata: result.metadata,
      };
    } catch (err) {
      const status = err && typeof err === 'object' && 'status' in err ? err.status : undefined;
      if (params.signal?.aborted || (err instanceof ImageProviderError && !err.retryable) || ![401, 403, 429].includes(Number(status))) throw err;
      lastError = err;
      const durationMs = Date.now() - startedAt;
      recordCapabilityCandidateFailure({
        attempts,
        provider: candidate.provider,
        model: candidate.model,
        error: err,
        durationMs,
      });
      const last = attempts[attempts.length - 1];
      const description = isFailoverError(err) ? describeFailoverError(err) : undefined;
      log.warn(
        {
          err,
          provider: candidate.provider,
          model: candidate.model,
          status: last?.status,
          reason: last?.reason,
          durationMs,
          phase: 'candidate_failed',
          attemptCount: attempts.length,
        },
        `image-generation candidate failed: ${candidate.provider}/${candidate.model}: ${
          description ?? last?.error ?? (err instanceof Error ? err.message : String(err))
        }`,
      );
    }
  }

  return throwCapabilityGenerationFailure({
    capabilityLabel: 'image generation',
    attempts,
    lastError,
  });
}

export function listImageGenerationProvidersSummary(): ImageGenerationProviderSummary[] {
  return listProvidersSummaryFromRegistry();
}

// ============================================
// Helpers
// ============================================

function buildProviderRequest(input: {
  provider: ImageGenerationProvider;
  candidate: { provider: string; model: string };
  params: GenerateImageParams;
}): ImageGenerationRequest {
  const { provider, candidate, params } = input;
  const inputImages = params.inputImages
    ? cloneInputImages(params.inputImages)
    : undefined;
  return {
    provider: provider.id,
    model: candidate.model,
    prompt: params.prompt,
    ...(params.cfg ? { cfg: params.cfg } : {}),
    ...(params.agentId ? { agentId: params.agentId } : {}),
    ...(params.agentDir ? { agentDir: params.agentDir } : {}),
    ...(params.authStore ? { authStore: params.authStore } : {}),
    ...(typeof params.timeoutMs === 'number' ? { timeoutMs: params.timeoutMs } : {}),
    ...(params.signal ? { signal: params.signal } : {}),
    ...(typeof params.count === 'number' ? { count: params.count } : {}),
    ...(params.size !== undefined ? { size: params.size } : {}),
    ...(params.aspectRatio !== undefined ? { aspectRatio: params.aspectRatio } : {}),
    ...(params.resolution !== undefined ? { resolution: params.resolution } : {}),
    ...(params.quality !== undefined ? { quality: params.quality } : {}),
    ...(params.outputFormat !== undefined ? { outputFormat: params.outputFormat } : {}),
    ...(params.background !== undefined ? { background: params.background } : {}),
    ...(inputImages ? { inputImages } : {}),
    ...(params.providerOptions ? { providerOptions: params.providerOptions } : {}),
  };
}

function cloneInputImages(images: ImageGenerationSourceImage[]): ImageGenerationSourceImage[] {
  return images.map((img) => ({
    buffer: img.buffer,
    mimeType: img.mimeType,
    ...(img.fileName ? { fileName: img.fileName } : {}),
    ...(img.metadata ? { metadata: img.metadata } : {}),
  }));
}

function toCapabilityCandidate(provider: ImageGenerationProvider): CapabilityProviderCandidate {
  return {
    id: provider.id,
    defaultModel: provider.defaultModel,
    models: provider.models,
    isConfigured: provider.isConfigured,
  };
}

function buildNoImageGenerationModelConfiguredMessage(
  cfg: Config | undefined,
  deps: ImageGenerationRuntimeDeps,
): string {
  const list = (deps.listProviders ?? listImageGenerationProviders)(cfg);
  return buildNoCapabilityModelConfiguredMessage({
    capabilityLabel: 'image-generation',
    modelConfigKey: 'imageGeneration',
    providers: list.map(toCapabilityCandidate),
    getProviderEnvVars: deps.getProviderEnvVars ?? ((id) => PROVIDER_ENV_MAP[id]),
  });
}

// Re-export the canonical capability type for callers consuming this barrel.
export type { ImageGenerationProviderCapabilities };
// Re-export the provider-registry surface that gateway routes / CLI consume
// through this single barrel module. NOTE: `listImageGenerationProvidersSummary`
// is implemented locally above (it overlays cfg-aware `configured` flags), so
// it must not be re-exported from the registry to avoid a name clash.
export {
  getImageGenerationProvider,
  listImageGenerationProviders,
} from './provider-registry.js';

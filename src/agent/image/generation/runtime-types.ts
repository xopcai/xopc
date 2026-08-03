/**
 * Public runtime params / result for the image-generation pipeline.
 *
 * Kept in a dedicated module (separate from {@link ./types.ts}) so the
 * runtime-only contract (deps, attempts) does not pollute the Provider-facing
 * types. {@link ./runtime.ts} re-exports the symbols below for callers that
 * want a single import surface.
 */

import type { Config } from '../../../config/schema.js';
import type { ToolModelConfig } from '../tool-model-config.js';
import type { AuthProfileStore } from '../../../providers/auth-runtime/index.js';
import type { FallbackAttempt } from '../../failover-error.js';
import type {
  GeneratedImageAsset,
  ImageGenerationBackground,
  ImageGenerationIgnoredOverride,
  ImageGenerationNormalization,
  ImageGenerationOutputFormat,
  ImageGenerationProvider,
  ImageGenerationProviderOptions,
  ImageGenerationQuality,
  ImageGenerationResolution,
  ImageGenerationSourceImage,
} from './types.js';

export interface GenerateImageParams {
  /** Active xopc config. Optional in Step 2 to keep tool-level callers compatible. */
  cfg?: Config;
  prompt: string;
  agentId?: string;
  agentDir?: string;
  authStore?: AuthProfileStore;
  modelConfig?: ToolModelConfig;
  modelOverride?: string;
  count?: number;
  size?: string;
  aspectRatio?: string;
  resolution?: ImageGenerationResolution;
  quality?: ImageGenerationQuality;
  outputFormat?: ImageGenerationOutputFormat;
  background?: ImageGenerationBackground;
  inputImages?: ImageGenerationSourceImage[];
  /** Enumerate every isConfigured() provider's defaultModel as fallback. */
  autoProviderFallback?: boolean;
  /** Per-call timeout (ms). Combined with provider defaults via provider-http. */
  timeoutMs?: number;
  /** Upstream cancellation. */
  signal?: AbortSignal;
  providerOptions?: ImageGenerationProviderOptions;
}

export interface GenerateImageRuntimeResult {
  images: GeneratedImageAsset[];
  provider: string;
  model: string;
  attempts: FallbackAttempt[];
  normalization?: ImageGenerationNormalization;
  ignoredOverrides: ImageGenerationIgnoredOverride[];
  metadata?: Record<string, unknown>;
}

/**
 * Forward-declared dependency injection for the runtime. {@link ./runtime.ts}
 * defines the concrete defaults; tests pass mocks here without touching env.
 */
export interface ImageGenerationRuntimeDeps {
  getProvider?: (id: string, cfg?: Config) => ImageGenerationProvider | undefined;
  listProviders?: (cfg?: Config) => ImageGenerationProvider[];
  getProviderEnvVars?: (id: string) => readonly string[] | undefined;
  log?: { warn(msg: string): void; debug?(msg: string): void };
}

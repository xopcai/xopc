import type { Config } from '../../../config/schema.js';
import type { AuthProfileStore } from '../../../providers/auth-runtime/index.js';
import type { FallbackAttempt } from '../../failover-error.js';
import type { MediaNormalizationEntry } from '../../media-generation/normalization.types.js';

// Re-export the provider contract from `provider-registry.ts` so callers can
// continue importing it from `./types.js` (single import surface).
// NOTE: this re-export creates a known circular cycle with `provider-registry.ts`
// (which imports `ImageGenerationCapabilities*` from this file). It is preserved
// because removing it breaks 5 extension packages' public API. Suppressed via
// dependency-cruiser at the warning level.
export type {
  ImageGenerationProvider,
  ImageGenerationProviderConfiguredContext,
  ImageGenerationProviderSummary,
} from './provider-registry.js';
export type {
  ImageProviderUiBaseUrlPreset,
  ImageProviderUiMetadata,
  ImageProviderUiPresetKind,
  ImageProviderUiRegionOption,
} from './image-provider-ui.js';

// ============================================
// Capability dimensions (Step 2 — new model)
// ============================================

export type ImageGenerationResolution = '1K' | '2K' | '4K';
export type ImageGenerationQuality = 'low' | 'medium' | 'high' | 'auto';
export type ImageGenerationOutputFormat = 'png' | 'jpeg' | 'webp';
export type ImageGenerationBackground = 'transparent' | 'opaque' | 'auto';

/** Generation-mode (text → image) capability slice. */
export interface ImageGenerationGenerateCapability {
  /** Maximum images per call (defaults to 1 when omitted). */
  maxCount?: number;
  /** Provider supports an explicit `size` parameter. */
  supportsSize?: boolean;
  /** Provider supports `aspectRatio` parameter. */
  supportsAspectRatio?: boolean;
  /** Provider supports `resolution` parameter. */
  supportsResolution?: boolean;
}

/** Edit-mode (image → image) capability slice. */
export interface ImageGenerationEditCapability {
  enabled: boolean;
  /** Max number of input reference images (1 = single ref). */
  maxInputImages?: number;
  supportsSize?: boolean;
  supportsAspectRatio?: boolean;
}

/** Geometry constraints (allowed values for size / aspectRatio / resolution). */
export interface ImageGenerationGeometryCapability {
  sizes?: string[];
  aspectRatios?: string[];
  resolutions?: ImageGenerationResolution[];
}

/** Output / styling capability slice. */
export interface ImageGenerationOutputCapability {
  qualities?: ImageGenerationQuality[];
  formats?: ImageGenerationOutputFormat[];
  backgrounds?: ImageGenerationBackground[];
}

/** New nested capability shape. */
export interface ImageGenerationProviderCapabilities {
  generate?: ImageGenerationGenerateCapability;
  edit?: ImageGenerationEditCapability;
  geometry?: ImageGenerationGeometryCapability;
  output?: ImageGenerationOutputCapability;
}

// ============================================
// Per-vendor escape hatch
// ============================================

export interface ImageGenerationOpenAIOptions {
  background?: ImageGenerationBackground;
  moderation?: 'low' | 'auto';
  outputCompression?: number;
  user?: string;
}

export interface ImageGenerationProviderOptions {
  openai?: ImageGenerationOpenAIOptions;
  // Future: dashscope?: ImageGenerationDashScopeOptions; minimax?: ...; google?: ...; fal?: ...;
}

// ============================================
// Assets
// ============================================

export interface GeneratedImageAsset {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
  /** Provider-side prompt rewrite (e.g. OpenAI dall-e-3 / gpt-image-1). */
  revisedPrompt?: string;
  /** Vendor-private metadata. Not surfaced to the LLM context directly. */
  metadata?: Record<string, unknown>;
}

export interface ImageGenerationSourceImage {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
  metadata?: Record<string, unknown>;
}

// ============================================
// Normalization output
// ============================================

export type ImageGenerationIgnoredOverrideKey =
  | 'size'
  | 'aspectRatio'
  | 'resolution'
  | 'quality'
  | 'outputFormat'
  | 'background';

export interface ImageGenerationIgnoredOverride {
  key: ImageGenerationIgnoredOverrideKey;
  value: string;
}

export interface ImageGenerationNormalization {
  size?: MediaNormalizationEntry<string>;
  aspectRatio?: MediaNormalizationEntry<string>;
  resolution?: MediaNormalizationEntry<ImageGenerationResolution>;
}

// ============================================
// Request / result (after normalization)
// ============================================

export interface ImageGenerationRequest {
  provider: string;
  model: string;
  prompt: string;
  cfg?: Config;
  agentDir?: string;
  authStore?: AuthProfileStore;
  timeoutMs?: number;
  signal?: AbortSignal;
  count?: number;
  size?: string;
  aspectRatio?: string;
  resolution?: ImageGenerationResolution;
  quality?: ImageGenerationQuality;
  outputFormat?: ImageGenerationOutputFormat;
  background?: ImageGenerationBackground;
  inputImages?: ImageGenerationSourceImage[];
  providerOptions?: ImageGenerationProviderOptions;
}

export interface ImageGenerationResult {
  images: GeneratedImageAsset[];
  model?: string;
  metadata?: Record<string, unknown>;
}

// ============================================
// Backward-compatible aliases (Step 2)
// ============================================

/** @deprecated Use {@link FallbackAttempt} from `../failover-error.js`. */
export type ImageGenFallbackAttempt = FallbackAttempt;

/**
 * @deprecated Legacy flat capability shape from Step 1. Kept for backward
 * compatibility while older code migrates to {@link ImageGenerationProviderCapabilities}.
 */
export interface ImageGenerationCapabilitiesLegacy {
  supportsEdit: boolean;
  maxInputImages?: number;
  maxOutputImages?: number;
  supportedSizes?: string[];
}

/**
 * @deprecated Use {@link ImageGenerationProviderCapabilities}. The legacy alias
 * remains so existing code compiles unchanged during Step 2.
 */
export type ImageGenerationCapabilities = ImageGenerationCapabilitiesLegacy;

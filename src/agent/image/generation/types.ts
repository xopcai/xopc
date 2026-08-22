import type { Config } from '../../../config/schema.js';
import type { AuthProfileStore } from '../../../providers/auth-runtime/index.js';
import type { MediaNormalizationEntry } from '../../media-generation/normalization.types.js';

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

export interface ImageGenerationProviderConfiguredContext {
  cfg?: Config;
  agentId?: string;
  agentDir?: string;
}

export interface ImageGenerationProvider {
  id: string;
  label: string;
  source?: 'builtin' | 'custom';
  credentialMode?: 'api-key' | 'oauth' | 'none';
  documentationUrl?: string;
  apiKeyUrl?: string;
  defaultModel: string;
  models: string[];
  capabilities: ImageGenerationProviderCapabilities;
  /** Per-model capability declarations when models on one endpoint differ. */
  modelCapabilities?: Record<string, ImageGenerationProviderCapabilities>;
  isConfigured(ctx: ImageGenerationProviderConfiguredContext): boolean;
  generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

export interface ImageGenerationProviderSummary {
  id: string;
  label: string;
  source: 'builtin' | 'custom';
  credentialMode: 'api-key' | 'oauth' | 'none';
  documentationUrl?: string;
  apiKeyUrl?: string;
  defaultModel: string;
  models: string[];
  capabilities: ImageGenerationProviderCapabilities;
  modelCapabilities?: Record<string, ImageGenerationProviderCapabilities>;
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
  /** Provider-side prompt rewrite. */
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
  agentId?: string;
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

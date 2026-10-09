import type { Config } from '../../../config/schema.js';
import type { AuthProfileStore } from '../../../providers/auth-runtime/index.js';

// ============================================
// Capability dimensions (Step 2 — new model)
// ============================================

export type ImageGenerationResolution = '1K' | '2K' | '4K';
export type ImageGenerationQuality = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';
export type ImageGenerationOutputFormat = 'png' | 'jpeg' | 'webp';
export type ImageGenerationBackground = 'transparent' | 'opaque' | 'auto';

export type { ImageGeometry as ImageGenerationGeometryCapability } from '../../../../packages/image-providers/src/types.js';
export type ImageGenerationProviderCapabilities = import('../../../../packages/image-providers/src/types.js').ImageCapabilities;

export interface ImageGenerationProviderConfiguredContext {
  cfg?: Config;
  agentId?: string;
  agentDir?: string;
}

export interface ImageGenerationProviderConfigField {
  key: 'baseUrl' | 'region';
  label: string;
  type: 'url' | 'select';
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface ImageGenerationProvider {
  id: string;
  label: string;
  source?: 'builtin' | 'custom';
  credentialMode?: 'api-key' | 'oauth' | 'none';
  documentationUrl?: string;
  apiKeyUrl?: string;
  configFields?: ImageGenerationProviderConfigField[];
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
  configFields: ImageGenerationProviderConfigField[];
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

import type { Config } from '../config/schema.js';

export type GeneratedImageAsset = {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
  revisedPrompt?: string;
};

export type ImageGenerationResult = {
  images: GeneratedImageAsset[];
  model?: string;
};

export type ImageGenFallbackAttempt = {
  provider: string;
  model: string;
  error: string;
};

export type ImageGenerationRequest = {
  provider: string;
  model: string;
  prompt: string;
  cfg?: Config;
  count?: number;
  size?: string;
  signal?: AbortSignal;
};

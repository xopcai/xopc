/**
 * Unified image stack: understanding (pi-ai multimodal) under this folder;
 * generation (bundled extension providers under `./generation/`).
 */
export {
  describeImages,
  describeImagesWithFallback,
  type DescribeImagesParams,
  type DescribeImagesWithFallbackParams,
  type DescribeImagesWithFallbackResult,
  type DescribeImagesAttempt,
} from './understanding/runtime.js';
export {
  registerImageUnderstandingProvider,
  getImageUnderstandingProvider,
  listImageUnderstandingProviders,
} from './understanding/provider-registry.js';
export type {
  ImageUnderstandingProvider,
  ImageUnderstandingRequest,
  ImageUnderstandingResult,
} from './understanding/types.js';
export { loadImageForToolInput } from './load-image-media.js';
export type { LoadedImage } from './load-image-media.js';
export { runWithImageModelFallback } from './image-model-fallback.js';
export type { ImageAttempt } from './image-model-fallback.js';
export type { ToolModelConfig } from './tool-model-config.js';
export { resolveImageModelConfigForTool } from './tool-model-config.js';
export {
  generateImage,
  listImageGenerationProvidersSummary,
  type GenerateImageParams,
  type GenerateImageRuntimeResult,
} from './generation/runtime.js';
export {
  registerImageGenerationProvider,
  getImageGenerationProvider,
  listImageGenerationProviders,
  type ImageGenerationProvider,
} from './generation/provider-registry.js';
export type {
  ImageGenerationSourceImage,
  ImageGenerationProviderCapabilities,
} from './generation/types.js';
export {
  modelSupportsVision,
  resolveImageHandlingStrategy,
  type ImageHandlingStrategy,
} from './vision-detection.js';

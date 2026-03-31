/**
 * Unified image stack: understanding (pi-ai multimodal) under this folder;
 * generation (OpenAI Images API; DashScope Beijing wan2.6-t2i via `qwen/`) under `./generation/`.
 */
export { describeImagesWithPiAi } from './describe-images.js';
export { loadImageForToolInput } from './load-image-media.js';
export type { LoadedImage } from './load-image-media.js';
export { runWithImageModelFallback } from './image-model-fallback.js';
export type { ImageAttempt } from './image-model-fallback.js';
export type { ToolModelConfig } from './tool-model-config.js';
export {
  generateImage,
  listImageGenerationProvidersSummary,
  type GenerateImageParams,
  type GenerateImageRuntimeResult,
} from './generation/runtime.js';
export { OPENAI_DEFAULT_IMAGE_MODEL, QWEN_DEFAULT_IMAGE_MODEL } from './generation/constants.js';

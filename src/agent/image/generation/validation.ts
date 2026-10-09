import { validateImageRequest } from '@xopcai/image-providers';

import type { ImageGenerationProvider, ImageGenerationRequest } from './types.js';

export interface ImageGenerationValidationParams extends Pick<ImageGenerationRequest, 'size' | 'count' | 'aspectRatio' | 'resolution' | 'quality' | 'outputFormat' | 'background' | 'inputImages'> {
  provider: ImageGenerationProvider;
}
export function validateImageGenerationRequest(params: ImageGenerationValidationParams): void {
  validateImageRequest({ ...params, model: params.provider.defaultModel, prompt: 'validate',
    inputImages: params.inputImages?.map((image, index) => ({ blob: new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }), fileName: image.fileName ?? `image-${index}` })),
  }, params.provider.capabilities);

}
export type { ImageGenerationProviderCapabilities } from './types.js';

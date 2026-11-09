import type { ImageGeometry, ImageRequest } from './types.js';

// Seedream 5.0 Flash/Pro image-generation limits, not the 4.0/4.5 limits.
export const seedreamGeometry: ImageGeometry = {
  sizes: ['1K', '1.5K', '2K'],
  aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  resolutions: ['1K', '2K'],
  pixels: { minPixels: 921600, maxPixels: 4624220, minEdge: 1, maxEdge: 8601, step: 1, maxRatio: 16 },
};

/** Preserve explicit ratios with integer pixels instead of rewriting the prompt. */
export function seedreamSize(request: ImageRequest): string {
  if (request.size) return request.size;
  const resolution = request.resolution ?? '2K';
  if (!request.aspectRatio) return resolution;
  const [width, height] = request.aspectRatio.split(':').map(Number);
  const edge = resolution === '1K' ? 1024 : 2048;
  const factor = Math.floor(Math.sqrt(edge ** 2 / (width! * height!)));
  return `${width! * factor}x${height! * factor}`;
}

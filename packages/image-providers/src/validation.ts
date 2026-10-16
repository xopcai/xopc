import type { ImageCapabilities, ImageGeometry, ImageRequest } from './types.js';

export class ImageProviderError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryable = false) { super(message); this.name = 'ImageProviderError'; }
}

export function validateImageRequest(request: ImageRequest, caps: ImageCapabilities): void {
  const fail = (message: string): never => { throw new ImageProviderError(message, 400); };
  if (request.openai?.outputCompression !== undefined && (!Number.isInteger(request.openai.outputCompression) || request.openai.outputCompression < 0 || request.openai.outputCompression > 100)) fail('Invalid output compression');
  if (request.openai?.moderation && !['low', 'auto'].includes(request.openai.moderation)) fail('Invalid moderation');
  if (!request.prompt?.trim()) fail('Image prompt is required');
  const count = request.count ?? 1;
  if (!Number.isSafeInteger(count) || count < 1 || count > (caps.generate?.maxCount ?? 1)) fail(`Unsupported image count: ${count}`);
  const inputs = request.inputImages ?? [];
  const editing = inputs.length > 0;
  if (editing && (!caps.edit?.enabled || inputs.length > (caps.edit.maxInputImages ?? 0))) fail('Unsupported image editing or reference image count');
  let bytes = 0;
  for (const image of inputs) {
    bytes += image.blob.size;
    if (!(caps.edit?.inputFormats ?? ['png', 'jpeg', 'webp']).map(format => `image/${format}`).includes(image.blob.type) || image.blob.size === 0 || image.blob.size > (caps.edit?.maxInputBytes ?? 25 * 1024 * 1024)) fail('Invalid input image format or size');
  }
  if (bytes > 64 * 1024 * 1024) fail('Input images exceed total byte limit');
  const mode = editing ? caps.edit : caps.generate;
  const geometry = editing && caps.edit?.geometry ? caps.edit.geometry : caps.geometry;
  if (request.size && (!mode?.supportsSize || !isSupportedImageSize(request.size, geometry))) fail(`Unsupported image size: ${request.size}`);
  if (request.aspectRatio && (!mode?.supportsAspectRatio || !geometry?.aspectRatios?.includes(request.aspectRatio))) fail(`Unsupported aspect ratio: ${request.aspectRatio}`);
  if (request.resolution && (!mode?.supportsResolution || !geometry?.resolutions?.includes(request.resolution))) fail(`Unsupported resolution: ${request.resolution}`);
  if (request.size && (request.aspectRatio || request.resolution)) fail('size cannot be combined with aspectRatio or resolution');
  if (request.quality && !caps.output?.qualities?.includes(request.quality)) fail(`Unsupported image quality: ${request.quality}`);
  if (request.outputFormat && !caps.output?.formats?.includes(request.outputFormat)) fail(`Unsupported image format: ${request.outputFormat}`);
  if (request.background && !caps.output?.backgrounds?.includes(request.background)) fail(`Unsupported image background: ${request.background}`);
  if (request.background === 'transparent' && request.outputFormat === 'jpeg') fail('Transparent images require PNG or WebP');
}

/** Translate ratios only when the selected model has an exact supported pixel size. */
export function normalizeImageGeometry<T extends { size?: string; aspectRatio?: string; resolution?: unknown }>(request: T, caps: ImageCapabilities, editing = false): T {
  const mode = editing ? caps.edit : caps.generate;
  if (!request.aspectRatio || mode?.supportsAspectRatio || !mode?.supportsSize || request.resolution) return request;
  const ratio = /^(\d+):(\d+)$/.exec(request.aspectRatio);
  if (!ratio || Number(ratio[1]) <= 0 || Number(ratio[2]) <= 0) return request;
  const geometry = editing && caps.edit?.geometry ? caps.edit.geometry : caps.geometry;
  const sizes = request.size ? [request.size] : geometry?.sizes ?? [];
  const size = sizes.find(value => {
    const dimensions = /^(\d+)x(\d+)$/.exec(value);
    return dimensions && Number(dimensions[1]) * Number(ratio[2]) === Number(dimensions[2]) * Number(ratio[1])
      && isSupportedImageSize(value, geometry);
  });
  if (!size) return request;
  const { aspectRatio: _aspectRatio, ...rest } = request;
  return { ...rest, size } as T;
}

export function isSupportedImageSize(size: string, geometry?: ImageGeometry): boolean {
  if (geometry?.sizes?.includes(size)) return true;
  const match = /^(\d+)x(\d+)$/.exec(size);
  const bounds = geometry?.pixels;
  if (!match || !bounds) return false;
  const width = Number(match[1]), height = Number(match[2]), pixels = width * height;
  return width >= bounds.minEdge && height >= bounds.minEdge && width <= bounds.maxEdge && height <= bounds.maxEdge
    && width % bounds.step === 0 && height % bounds.step === 0 && pixels >= bounds.minPixels && pixels <= bounds.maxPixels
    && Math.max(width / height, height / width) <= bounds.maxRatio;
}

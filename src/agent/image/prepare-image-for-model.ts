export const MODEL_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const MODEL_IMAGE_SOURCE_MAX_BYTES = 32 * 1024 * 1024;

const INITIAL_MAX_DIMENSION = 2048;
const MIN_MAX_DIMENSION = 512;
const INITIAL_QUALITY = 84;
const MIN_QUALITY = 40;
const MAX_OPTIMIZATION_ATTEMPTS = 6;

export type PreparedModelImage = {
  buffer: Buffer;
  mimeType: string;
  optimized: boolean;
  originalBytes: number;
};

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/**
 * Keep small images byte-for-byte. Oversized images are converted to a bounded
 * WebP derivative for model input; the original media-store object is untouched.
 */
export async function prepareImageForModel(
  buffer: Buffer,
  mimeType: string,
  maxBytes = MODEL_IMAGE_MAX_BYTES,
): Promise<PreparedModelImage> {
  if (buffer.byteLength <= maxBytes) {
    return {
      buffer,
      mimeType,
      optimized: false,
      originalBytes: buffer.byteLength,
    };
  }

  let maxDimension = INITIAL_MAX_DIMENSION;
  let quality = INITIAL_QUALITY;
  let smallest: Buffer | undefined;
  const { default: sharp } = await import('sharp');

  for (let attempt = 0; attempt < MAX_OPTIMIZATION_ATTEMPTS; attempt += 1) {
    const candidate = await sharp(buffer, {
      animated: false,
      failOn: 'error',
      limitInputPixels: 100_000_000,
    })
      .rotate()
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality, effort: 4 })
      .toBuffer();

    if (!smallest || candidate.byteLength < smallest.byteLength) {
      smallest = candidate;
    }
    if (candidate.byteLength <= maxBytes) {
      return {
        buffer: candidate,
        mimeType: 'image/webp',
        optimized: true,
        originalBytes: buffer.byteLength,
      };
    }

    const sizeRatio = Math.sqrt(maxBytes / candidate.byteLength);
    maxDimension = Math.max(
      MIN_MAX_DIMENSION,
      Math.floor(maxDimension * Math.min(0.85, sizeRatio * 0.95)),
    );
    quality = Math.max(MIN_QUALITY, quality - 9);
  }

  throw new Error(
    `Image could not be optimized below ${formatMiB(maxBytes)} `
      + `(original ${formatMiB(buffer.byteLength)}, smallest ${formatMiB(smallest?.byteLength ?? buffer.byteLength)})`,
  );
}

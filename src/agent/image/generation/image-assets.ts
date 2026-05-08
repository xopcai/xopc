/**
 * Image asset helpers — base64 / data-url decode + MIME sniffing + extension
 * mapping. Pure functions reused across vendor providers.
 */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const GIF_MAGIC = Buffer.from('GIF8');
const WEBP_RIFF = Buffer.from('RIFF');
const WEBP_FORMAT = Buffer.from('WEBP');

export interface SniffedImage {
  mimeType: string;
  fileExtension: string;
}

const DEFAULT_SNIFFED: SniffedImage = { mimeType: 'image/png', fileExtension: 'png' };

/** Detect a common image format from its leading bytes. Defaults to PNG. */
export function sniffImageMimeType(buffer: Buffer | Uint8Array): SniffedImage {
  const view = buffer instanceof Buffer ? buffer : Buffer.from(buffer);
  if (view.length >= 8 && view.subarray(0, 8).equals(PNG_MAGIC)) {
    return { mimeType: 'image/png', fileExtension: 'png' };
  }
  if (view.length >= 3 && view.subarray(0, 3).equals(JPEG_MAGIC)) {
    return { mimeType: 'image/jpeg', fileExtension: 'jpg' };
  }
  if (view.length >= 4 && view.subarray(0, 4).equals(GIF_MAGIC)) {
    return { mimeType: 'image/gif', fileExtension: 'gif' };
  }
  if (
    view.length >= 12 &&
    view.subarray(0, 4).equals(WEBP_RIFF) &&
    view.subarray(8, 12).equals(WEBP_FORMAT)
  ) {
    return { mimeType: 'image/webp', fileExtension: 'webp' };
  }
  return DEFAULT_SNIFFED;
}

/** Map a MIME type to a canonical file extension (no dot). */
export function imageFileExtensionForMimeType(mimeType: string | undefined): string {
  if (!mimeType) return 'png';
  const lower = mimeType.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('bmp')) return 'bmp';
  if (lower.includes('svg')) return 'svg';
  return 'png';
}

export interface ParsedImageDataUrl {
  mimeType: string;
  base64: string;
}

/**
 * Parse a `data:image/<format>;base64,<payload>` URL.
 * Returns null on malformed input or non-image data URLs.
 */
export function parseImageDataUrl(input: string): ParsedImageDataUrl | null {
  if (typeof input !== 'string') return null;
  const m = /^data:(image\/[\w.+-]+)(;base64)?,([\s\S]*)$/i.exec(input.trim());
  if (!m) return null;
  const mimeType = m[1].toLowerCase();
  const isBase64 = Boolean(m[2]);
  const payload = m[3] ?? '';
  if (!isBase64) {
    // Treat as URL-encoded text; convert to base64 for uniform downstream handling.
    return {
      mimeType,
      base64: Buffer.from(decodeURIComponent(payload), 'utf8').toString('base64'),
    };
  }
  // Strip whitespace that some clients introduce.
  return { mimeType, base64: payload.replace(/\s+/g, '') };
}

/** Convert a base64 string into a sniffed asset descriptor. */
export function imageAssetFromBase64(params: {
  base64: string;
  mimeType?: string;
  fileName?: string;
}): { buffer: Buffer; mimeType: string; fileName?: string } {
  const buffer = Buffer.from(params.base64.replace(/\s+/g, ''), 'base64');
  const detected = sniffImageMimeType(buffer);
  const mimeType = params.mimeType?.trim() || detected.mimeType;
  return {
    buffer,
    mimeType,
    ...(params.fileName ? { fileName: params.fileName } : {}),
  };
}

/** Convert a data URL into a sniffed asset descriptor. */
export function imageAssetFromDataUrl(input: string, fileName?: string): {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
} | null {
  const parsed = parseImageDataUrl(input);
  if (!parsed) return null;
  return imageAssetFromBase64({ base64: parsed.base64, mimeType: parsed.mimeType, fileName });
}

/** Best-effort MIME type from a file name (suffix only). */
export function mimeTypeFromFileName(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined;
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return undefined;
}

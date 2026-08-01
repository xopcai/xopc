import { basename } from 'node:path';

import { sniffImageMimeType } from '../image/generation/image-assets.js';
import { mimeTypeFromMediaPath, saveMediaBuffer } from '../../media/store.js';
import type { MediaRef } from '../../media/types.js';

export type ToolMediaType = 'photo' | 'video' | 'audio' | 'document';
const MAX_TOOL_MEDIA_BYTES = 50 * 1024 * 1024;

function hasImageMagic(buffer: Buffer): boolean {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return true;
  }
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return true;
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'GIF8') {
    return true;
  }
  return buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
}

export function detectToolMediaMimeType(buffer: Buffer, filePath: string): string {
  if (hasImageMagic(buffer)) {
    return sniffImageMimeType(buffer).mimeType;
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  return mimeTypeFromMediaPath(filePath);
}

export function mediaTypeFromMimeType(mimeType: string): ToolMediaType {
  if (mimeType === 'image/svg+xml') return 'document';
  if (mimeType.startsWith('image/')) return 'photo';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

export async function persistToolMedia(params: {
  buffer: Buffer;
  filePath: string;
  mediaType?: ToolMediaType;
}): Promise<MediaRef> {
  const name = basename(params.filePath);
  const mimeType = detectToolMediaMimeType(params.buffer, params.filePath);
  const saved = await saveMediaBuffer(params.buffer, {
    bucket: 'outbound',
    contentType: mimeType,
    originalFilename: name,
    maxBytes: MAX_TOOL_MEDIA_BYTES,
  });
  return {
    id: saved.id,
    bucket: saved.bucket,
    type: params.mediaType ?? mediaTypeFromMimeType(mimeType),
    mimeType: saved.contentType,
    name,
    size: saved.size,
    uri: saved.uri,
    path: saved.path,
  };
}

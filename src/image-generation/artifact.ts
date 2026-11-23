import { randomUUID } from 'node:crypto';
import { link, mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import { imageFileExtensionForMimeType } from '../agent/image/generation/image-assets.js';
import { fileRangeResponse } from '../media-shared/http/file-response.js';
import { deleteMediaUris } from '../media/session-references.js';
import { resolveMediaBufferPath } from '../media/store.js';
import { buildMediaUri, tryParseMediaUri } from '../media/uri.js';

const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

export function imageArtifactId(jobId: string, index: number, mimeType: string): string {
  const ext = imageFileExtensionForMimeType(mimeType);
  return `image-${jobId}-${index}.${ext}`;
}

export function imageArtifactMediaUri(jobId: string, index: number, mimeType: string): string {
  return buildMediaUri('outbound', imageArtifactId(jobId, index, mimeType));
}

export async function saveImageArtifact(
  jobId: string,
  index: number,
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Generated image is empty or exceeds the size limit.');
  }
  const artifactId = imageArtifactId(jobId, index, mimeType);
  const path = resolveMediaBufferPath(artifactId, 'outbound');
  const temporary = `${path}.${randomUUID()}.part`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(buffer);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  } finally {
    await rm(temporary, { force: true });
  }
  return buildMediaUri('outbound', artifactId);
}

export async function deleteImageArtifacts(mediaUris: string[]): Promise<void> {
  if (mediaUris.length === 0) return;
  await deleteMediaUris(mediaUris, { strict: false });
}

export async function readImageArtifact(
  mediaUri: string,
  mimeType: string,
  rangeHeader?: string,
  download = false,
  headOnly = false,
): Promise<Response> {
  const parsed = tryParseMediaUri(mediaUri);
  if (!parsed || parsed.bucket !== 'outbound') return new Response(null, { status: 404 });
  const path = resolveMediaBufferPath(parsed.id, 'outbound');
  const file = await stat(path).catch(() => null);
  if (!file?.isFile() || !file.size || file.size > MAX_IMAGE_BYTES) {
    return new Response(null, { status: 404 });
  }
  const ext = imageFileExtensionForMimeType(mimeType);
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type': mimeType || 'image/png',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (download) headers.set('Content-Disposition', `attachment; filename="image.${ext}"`);
  return fileRangeResponse(path, file.size, rangeHeader, headers, headOnly);
}

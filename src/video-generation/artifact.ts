import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { deleteMediaUris } from '../media/session-references.js';
import { buildMediaUri } from '../media/uri.js';
import { resolveMediaBufferPath } from '../media/store.js';

const VIDEO_ARTIFACT_MAX_BYTES = 256 * 1024 * 1024;

export function videoArtifactPath(jobId: string): string {
  return resolveMediaBufferPath(`wan-${jobId}.mp4`, 'outbound');
}

export async function deleteVideoArtifact(jobId: string): Promise<void> {
  await deleteMediaUris([buildMediaUri('outbound', `wan-${jobId}.mp4`)], { strict: true });
}

export async function videoArtifactExists(jobId: string): Promise<boolean> {
  const info = await stat(videoArtifactPath(jobId)).catch(() => null);
  return Boolean(info?.isFile() && info.size > 0 && info.size <= VIDEO_ARTIFACT_MAX_BYTES);
}

export async function storeVideoArtifact(jobId: string, response: Response): Promise<void> {
  const path = videoArtifactPath(jobId);
  const temporary = `${path}.${randomUUID()}.part`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > VIDEO_ARTIFACT_MAX_BYTES) return callback(new Error('Generated video exceeds the media size limit'));
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body!), limit, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    // Windows requires a writable handle for fsync.
    const file = await open(temporary, 'r+');
    try {
      const header = Buffer.alloc(12);
      const { bytesRead } = await file.read(header);
      if (bytesRead < header.length || header.toString('ascii', 4, 8) !== 'ftyp') {
        throw new Error('Video provider returned an invalid MP4');
      }
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readVideoArtifact(jobId: string, rangeHeader?: string, download = false): Promise<Response> {
  const path = videoArtifactPath(jobId);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || !info.size || info.size > VIDEO_ARTIFACT_MAX_BYTES) return new Response(null, { status: 404 });

  const headers = new Headers({
    'Accept-Ranges': 'bytes', 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (download) headers.set('Content-Disposition', 'attachment; filename="generated-video.mp4"');

  let start = 0;
  let end = info.size - 1;
  if (rangeHeader) {
    const range = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader);
    if (range?.[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(end, Number(range[2]));
    } else if (range?.[2] && Number.isSafeInteger(Number(range[2]))) {
      start = Math.max(0, info.size - Number(range[2]));
    } else {
      start = info.size;
    }
    if (!Number.isSafeInteger(start) || start > end) {
      headers.set('Content-Range', `bytes */${info.size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${info.size}`);
  }

  headers.set('Content-Length', String(end - start + 1));
  return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>, {
    status: rangeHeader ? 206 : 200, headers,
  });
}

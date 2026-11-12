import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { parseByteRange } from '../media-shared/http/byte-range.js';
import { assertSafeUrl } from '../media-shared/http/ssrf-guard.js';
import { deleteMediaUris } from '../media/session-references.js';
import { buildMediaUri } from '../media/uri.js';
import { resolveMediaBufferPath } from '../media/store.js';
import type { MusicProvider } from './provider.js';

const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

function artifactPath(id: string): string {
  return resolveMediaBufferPath(`music-${id}.mp3`, 'outbound');
}

export async function musicArtifactExists(id: string): Promise<boolean> {
  const file = await stat(artifactPath(id)).catch(() => null);
  return Boolean(file?.isFile() && file.size > 0 && file.size <= MAX_AUDIO_BYTES);
}

export async function deleteMusicArtifact(id: string): Promise<void> {
  await deleteMediaUris([buildMediaUri('outbound', `music-${id}.mp3`)], { strict: true });
}

export async function saveMusicArtifact(id: string, provider: MusicProvider, source: string, canPublish: () => boolean): Promise<void> {
  const url = new URL(source);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !provider.allowsAudioHost(url.hostname)) {
    throw new Error('Music provider returned an untrusted audio URL.');
  }
  await assertSafeUrl(url);
  const path = artifactPath(id);
  const temporary = `${path}.${randomUUID()}.part`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  const response = await fetch(url, { signal: AbortSignal.timeout(45_000), redirect: 'error' });
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_AUDIO_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Music download failed or exceeded the size limit.');
  }

  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > MAX_AUDIO_BYTES) return callback(new Error('Generated music exceeds the size limit.'));
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    const file = await open(temporary, 'r');
    try {
      const header = Buffer.alloc(10);
      const { bytesRead } = await file.read(header);
      if (bytesRead !== header.length) throw new Error('Music provider returned incomplete MP3 audio.');
      let frameOffset = 0;
      if (header.subarray(0, 3).toString('ascii') === 'ID3') {
        const tagSize = header.subarray(6, 10);
        if (tagSize.some(byte => byte > 0x7f)) throw new Error('Music provider returned an invalid ID3 tag.');
        const footerSize = header[3] === 4 && (header[5] & 0x10) !== 0 ? 10 : 0;
        frameOffset = tagSize.reduce((length, byte) => (length << 7) | byte, 0) + 10 + footerSize;
      }
      const frame = Buffer.alloc(4);
      const frameRead = await file.read(frame, 0, frame.length, frameOffset);
      if (frameRead.bytesRead !== frame.length || size <= frameOffset + frame.length
        || frame[0] !== 0xff || (frame[1] & 0xe6) !== 0xe2 || (frame[1] & 0x18) === 0x08
        || (frame[2] & 0xf0) === 0xf0 || (frame[2] & 0x0c) === 0x0c) {
        throw new Error('Music provider returned invalid MP3 audio.');
      }
      await file.sync();
    } finally {
      await file.close();
    }
    if (!canPublish()) return;
    await link(temporary, path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readMusicArtifact(id: string, rangeHeader?: string, download = false): Promise<Response> {
  const path = artifactPath(id);
  const file = await stat(path).catch(() => null);
  if (!file?.isFile() || !file.size || file.size > MAX_AUDIO_BYTES) return new Response(null, { status: 404 });
  const headers = new Headers({
    'Accept-Ranges': 'bytes', 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (download) headers.set('Content-Disposition', 'attachment; filename="music.mp3"');
  const range = parseByteRange(rangeHeader, file.size);
  if (range === 'invalid') {
    headers.set('Content-Range', `bytes */${file.size}`);
    return new Response(null, { status: 416, headers });
  }
  if (range) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
  headers.set('Content-Length', String(range ? range.end - range.start + 1 : file.size));
  const stream = createReadStream(path, range ?? undefined);
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
}

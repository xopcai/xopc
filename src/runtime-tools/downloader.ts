import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { RuntimeError } from './errors.js';
import { fetchRuntimeResource, readRuntimeResponseText } from './network.js';
import type { RuntimeKind } from './types.js';

const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;
const MAX_CHECKSUM_BYTES = 1024 * 1024;

class RuntimeDownloadTransportError extends Error {
  constructor(message: string, readonly allowsSourceFallback: boolean, options?: ErrorOptions) {
    super(message, options);
  }
}

class RuntimeDownloadContentError extends Error {}

export function canFallbackRuntimeDownload(error: unknown): boolean {
  return error instanceof RuntimeError
    && error.code === 'RUNTIME_DOWNLOAD_FAILED'
    && error.cause instanceof RuntimeDownloadTransportError
    && error.cause.allowsSourceFallback;
}

async function fetchText(url: string, timeoutMs: number, proxy?: string, signal?: AbortSignal): Promise<string> {
  const response = await fetchRuntimeResource({
    url,
    timeoutMs,
    proxy,
    signal,
    init: { redirect: 'follow' },
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_CHECKSUM_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Checksum response exceeds size limit');
  }
  return await readRuntimeResponseText(response, MAX_CHECKSUM_BYTES);
}

export async function resolveExpectedChecksum(params: {
  runtime: 'node' | 'uv';
  checksumUrl: string;
  archiveFile: string;
  timeoutMs: number;
  proxy?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const text = await fetchText(params.checksumUrl, params.timeoutMs, params.proxy, params.signal);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([a-fA-F0-9]{64})(?:\s+[*]?(.+))?$/);
    if (!match) continue;
    if (!match[2] || match[2] === params.archiveFile) return match[1]!.toLowerCase();
  }
  throw new RuntimeError(
    `Checksum for ${params.archiveFile} was not found`,
    'RUNTIME_CHECKSUM_MISMATCH',
    params.runtime,
    'resolve_checksum',
    true,
  );
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function downloadVerifiedArchive(params: {
  runtime: RuntimeKind;
  url: string;
  targetPath: string;
  expectedSha256: string;
  timeoutMs: number;
  proxy?: string;
  signal?: AbortSignal;
  onProgress?: (downloadedBytes: number, totalBytes?: number) => void;
}): Promise<string> {
  await mkdir(dirname(params.targetPath), { recursive: true });
  const completedPath = params.targetPath.replace(/\.partial$/, '');
  try {
    await access(completedPath);
    if (await sha256File(completedPath) === params.expectedSha256.toLowerCase()) {
      return completedPath;
    }
    await rm(completedPath, { force: true });
  } catch {
    // Download and verify below.
  }
  try {
    let resumeOffset = await stat(params.targetPath)
      .then((info) => info.isFile() ? info.size : 0)
      .catch(() => 0);
    if (resumeOffset > MAX_ARCHIVE_BYTES) {
      await rm(params.targetPath, { force: true });
      resumeOffset = 0;
    }

    let response;
    const request = async (offset: number) => {
      try {
        return await fetchRuntimeResource({
          url: params.url,
          timeoutMs: params.timeoutMs,
          proxy: params.proxy,
          signal: params.signal,
          init: {
            redirect: 'follow',
            headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined,
          },
        });
      } catch (error) {
        throw new RuntimeDownloadTransportError(
          error instanceof Error ? error.message : String(error),
          !params.signal?.aborted,
          { cause: error },
        );
      }
    };
    response = await request(resumeOffset);
    if (resumeOffset > 0 && response.status === 416) {
      await response.body?.cancel().catch(() => {});
      await rm(params.targetPath, { force: true });
      resumeOffset = 0;
      response = await request(0);
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new RuntimeDownloadTransportError(
        `HTTP ${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }
    let total: number | undefined;
    if (response.status === 206) {
      const contentRange = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (!contentRange || Number(contentRange[1]) !== resumeOffset) {
        await response.body.cancel().catch(() => {});
        throw new RuntimeDownloadContentError('Invalid Content-Range response');
      }
      total = Number(contentRange[3]);
    } else {
      if (resumeOffset > 0) {
        await rm(params.targetPath, { force: true });
        resumeOffset = 0;
      }
      total = Number(response.headers.get('content-length')) || undefined;
    }
    if (total && total > MAX_ARCHIVE_BYTES) {
      await response.body.cancel().catch(() => {});
      throw new Error('Archive exceeds size limit');
    }

    let downloaded = resumeOffset;
    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        downloaded += chunk.byteLength;
        if (downloaded > MAX_ARCHIVE_BYTES) throw new Error('Archive exceeds size limit');
        params.onProgress?.(downloaded, total);
        controller.enqueue(chunk);
      },
    });
    await pipeline(
      response.body.pipeThrough(transform) as unknown as NodeJS.ReadableStream,
      createWriteStream(params.targetPath, {
        flags: resumeOffset > 0 ? 'a' : 'w',
        mode: 0o600,
      }),
    );
    if (total && downloaded !== total) {
      throw new RuntimeDownloadTransportError('Archive download was truncated', true);
    }
    const actual = await sha256File(params.targetPath);
    if (actual !== params.expectedSha256.toLowerCase()) {
      throw new RuntimeError(
        `Checksum mismatch for ${params.runtime} archive`,
        'RUNTIME_CHECKSUM_MISMATCH',
        params.runtime,
        'verify_archive',
        true,
      );
    }
    await rename(params.targetPath, completedPath);
    return completedPath;
  } catch (error) {
    if (
      error instanceof RuntimeDownloadContentError
      || (error instanceof RuntimeError && error.code === 'RUNTIME_CHECKSUM_MISMATCH')
      || (error instanceof Error && error.message === 'Archive exceeds size limit')
    ) {
      await rm(params.targetPath, { force: true });
    }
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError(
      `Failed to download ${params.runtime} runtime: ${error instanceof Error ? error.message : String(error)}`,
      'RUNTIME_DOWNLOAD_FAILED',
      params.runtime,
      'download',
      true,
      [],
      { cause: error },
    );
  }
}

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { LocalVoiceModelDefinition, LocalVoiceModelFile } from './models.js';

export interface LocalVoiceFileProgress {
  status: 'download';
  file: string;
  loaded: number;
  total: number;
  progress: number;
}

function resolveModelFileUrl(
  remoteHost: string,
  model: LocalVoiceModelDefinition,
  file: LocalVoiceModelFile,
): string {
  const base = remoteHost.endsWith('/') ? remoteHost : `${remoteHost}/`;
  const path = file.path.split('/').map(encodeURIComponent).join('/');
  return new URL(`${model.repository}/resolve/${model.revision}/${path}`, base).toString();
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function downloadFile(
  url: string,
  destination: string,
  expectedBytes: number,
  onBytes: (bytes: number) => void,
): Promise<void> {
  const existing = await stat(destination).catch(() => null);
  let offset = existing?.isFile() ? existing.size : 0;
  if (offset > expectedBytes) {
    await rm(destination, { force: true });
    offset = 0;
  }
  if (offset === expectedBytes) {
    onBytes(offset);
    return;
  }
  const response = await fetch(url, {
    redirect: 'follow',
    headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Model download failed with HTTP ${response.status}`);
  }
  const isResume = offset > 0 && response.status === 206;
  if (offset > 0 && !isResume) offset = 0;
  const declaredBytes = Number(response.headers.get('content-length'));
  const expectedResponseBytes = expectedBytes - offset;
  if (Number.isFinite(declaredBytes) && declaredBytes > 0 && declaredBytes !== expectedResponseBytes) {
    throw new Error(`Model download size mismatch: expected ${expectedResponseBytes}, received ${declaredBytes}`);
  }

  await mkdir(dirname(destination), { recursive: true });
  let loaded = offset;
  let lastReportedBytes = offset;
  let lastReportedAt = 0;
  const source = Readable.fromWeb(response.body as never);
  source.on('data', (chunk: Buffer) => {
    loaded += chunk.length;
    const now = Date.now();
    if (loaded === expectedBytes || loaded - lastReportedBytes >= 256 * 1024 || now - lastReportedAt >= 250) {
      lastReportedBytes = loaded;
      lastReportedAt = now;
      onBytes(loaded);
    }
  });
  await pipeline(source, createWriteStream(destination, { flags: isResume ? 'a' : 'w', mode: 0o600 }));
  if (loaded !== expectedBytes) {
    throw new Error(`Model download was incomplete: expected ${expectedBytes}, received ${loaded}`);
  }
}

async function verifyModelFile(path: string, file: LocalVoiceModelFile): Promise<void> {
  const info = await stat(path);
  if (info.size !== file.bytes) {
    throw new Error(`Model file size mismatch for ${file.path}`);
  }
  const actual = await sha256File(path);
  if (actual !== file.sha256) {
    throw new Error(`Model file checksum mismatch for ${file.path}`);
  }
}

export async function downloadLocalVoiceModelFiles(options: {
  model: LocalVoiceModelDefinition;
  destinationDir: string;
  remoteHosts: readonly string[];
  onProgress?: (progress: LocalVoiceFileProgress) => void;
}): Promise<void> {
  const files = options.model.files;
  if (!files?.length) throw new Error(`No downloadable files declared for ${options.model.id}`);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  let completedBytes = 0;

  for (const file of files) {
    const destination = join(options.destinationDir, file.path);
    let lastError: unknown;
    for (const host of options.remoteHosts) {
      try {
        await downloadFile(
          resolveModelFileUrl(host, options.model, file),
          destination,
          file.bytes,
          (fileBytes) => options.onProgress?.({
            status: 'download',
            file: file.path,
            loaded: completedBytes + fileBytes,
            total,
            progress: (completedBytes + fileBytes) / total,
          }),
        );
        await verifyModelFile(destination, file);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('checksum mismatch') || message.includes('size mismatch')) {
          await rm(destination, { force: true });
        }
      }
    }
    if (lastError) {
      throw lastError;
    }
    completedBytes += file.bytes;
  }
}

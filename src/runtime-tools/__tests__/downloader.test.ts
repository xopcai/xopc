import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { downloadVerifiedArchive } from '../downloader.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

async function withServer(
  handler: Parameters<typeof createServer>[0],
  run: (url: string) => Promise<void>,
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address unavailable');
    await run(`http://127.0.0.1:${address.port}/archive`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('verified runtime downloader', () => {
  it('resumes an existing partial archive with a byte range', async () => {
    const content = 'hello world';
    const directory = await mkdtemp(join(tmpdir(), 'xopc-runtime-download-'));
    temporaryDirectories.push(directory);
    const targetPath = join(directory, 'archive.partial');
    await writeFile(targetPath, 'hello ');

    await withServer((request, response) => {
      expect(request.headers.range).toBe('bytes=6-');
      response.writeHead(206, {
        'Content-Length': '5',
        'Content-Range': 'bytes 6-10/11',
      });
      response.end('world');
    }, async (url) => {
      const archive = await downloadVerifiedArchive({
        runtime: 'node',
        url,
        targetPath,
        expectedSha256: sha256(content),
        timeoutMs: 5_000,
      });
      expect(await readFile(archive, 'utf8')).toBe(content);
    });
  });

  it('restarts safely when the server ignores a range request', async () => {
    const content = 'complete archive';
    const directory = await mkdtemp(join(tmpdir(), 'xopc-runtime-download-'));
    temporaryDirectories.push(directory);
    const targetPath = join(directory, 'archive.partial');
    await writeFile(targetPath, 'stale');

    await withServer((_request, response) => {
      response.writeHead(200, { 'Content-Length': String(Buffer.byteLength(content)) });
      response.end(content);
    }, async (url) => {
      const archive = await downloadVerifiedArchive({
        runtime: 'uv',
        url,
        targetPath,
        expectedSha256: sha256(content),
        timeoutMs: 5_000,
      });
      expect(await readFile(archive, 'utf8')).toBe(content);
    });
  });
});

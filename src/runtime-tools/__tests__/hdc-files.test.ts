import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { stageHdcFiles } from '../hdc-files.js';
import type { PhoneDependencyAsset } from '../phone-dependency-catalog.js';
import type { PhoneDependencyProgress } from '../phone-dependencies.js';

const bodies = { '/hdc': Buffer.from('standalone-hdc'), '/usb': Buffer.from('standalone-usb') };
async function fixture(run: (value: { root: string; asset: PhoneDependencyAsset; requests: string[]; progress: PhoneDependencyProgress[]; stage: (signal?: AbortSignal) => Promise<string> }) => Promise<void>,
  handle?: (request: IncomingMessage, response: ServerResponse) => boolean) {
  const root = await mkdtemp(join(tmpdir(), 'xopc-hdc-files-'));
  const requests: string[] = []; const progress: PhoneDependencyProgress[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url!);
    if (handle?.(request, response)) return;
    const body = bodies[request.url as keyof typeof bodies];
    if (!body) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-length': body.length }); response.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test address');
  const base = `http://127.0.0.1:${address.port}`;
  const files = Object.entries(bodies).map(([path, body]) => ({ targetName: path.slice(1), filename: `minimal-${path.slice(1)}`, url: base + path, sizeBytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), fallbackUrls: [base + path] }));
  const asset: PhoneDependencyAsset = { ...files[0]!, kind: 'hdc', version: 'test', archive: false, files };
  try {
    await run({ root, asset, requests, progress, stage: signal => stageHdcFiles({ root: join(root, 'staging'), stateDir: root, asset,
      config: ConfigSchema.parse({}).runtimeTools, signal, check: () => signal?.throwIfAborted(), progress: event => progress.push(event) }) });
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

it('downloads only two pinned files and reports their combined size without fetching any archive', async () => {
  await fixture(async ({ stage, requests, progress }) => {
    const root = await stage();
    expect(requests).toEqual(['/hdc', '/usb']);
    expect((await readdir(root)).sort()).toEqual(['hdc', 'source.json', 'usb']);
    expect(await readFile(join(root, 'hdc'))).toEqual(bodies['/hdc']);
    const last = progress.filter(event => event.phase === 'download').at(-1)!;
    expect(last.downloadedBytes).toBe(bodies['/hdc'].length + bodies['/usb'].length);
    expect(last.totalBytes).toBe(last.downloadedBytes);
    expect(JSON.parse(await readFile(join(root, 'source.json'), 'utf8')).distribution.package).toBe('hdw2');
  });
});

it('uses only the alternate raw-file mirror after a transport failure', async () => {
  await fixture(async ({ stage, asset, requests }) => {
    asset.files![0]!.url = asset.files![0]!.url.replace('/hdc', '/missing');
    await stage();
    expect(requests).toEqual(['/missing', '/hdc', '/usb']);
  });
});

it('rejects a corrupted file without trying a different mirror or an SDK fallback', async () => {
  await fixture(async ({ stage, requests }) => {
    await expect(stage()).rejects.toMatchObject({ code: 'RUNTIME_CHECKSUM_MISMATCH' });
    expect(requests).toEqual(['/hdc', '/usb']);
  }, (request, response) => {
    if (request.url !== '/usb') return false;
    response.end(Buffer.alloc(bodies['/usb'].length, 0)); return true;
  });
});

it('rejects an unexpectedly large response before buffering a package-sized body', async () => {
  await fixture(async ({ stage, requests }) => {
    await expect(stage()).rejects.toMatchObject({ code: 'RUNTIME_DOWNLOAD_FAILED' });
    expect(requests.every(path => path === '/hdc')).toBe(true);
  }, (_request, response) => { response.writeHead(200, { 'content-length': 100_000_000 }); response.end('unexpected'); return true; });
});

it('does not download anything after cancellation', async () => {
  await fixture(async ({ stage, requests }) => {
    const controller = new AbortController(); controller.abort();
    await expect(stage(controller.signal)).rejects.toThrow();
    expect(requests).toEqual([]);
  });
});

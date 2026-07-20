import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { downloadLocalVoiceModelFiles } from '../model-files.js';
import type { LocalVoiceModelDefinition } from '../models.js';

describe('local voice model file downloads', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('downloads declared files and reports aggregate verified progress', async () => {
    const body = Buffer.from('sensevoice-test-model');
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-length': String(body.length) });
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    const root = join(tmpdir(), `xopc-voice-files-${process.pid}-${Date.now()}`);
    tempRoots.push(root);
    const model: LocalVoiceModelDefinition = {
      id: 'sensevoice-small',
      name: 'test',
      description: 'test',
      engine: 'sherpa-onnx',
      repository: 'test/repo',
      revision: 'revision',
      files: [{
        path: 'model.int8.onnx',
        bytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
      }],
      languages: ['zh'],
      approximateBytes: body.length,
    };
    const progress: number[] = [];

    try {
      await downloadLocalVoiceModelFiles({
        model,
        destinationDir: root,
        remoteHosts: [`http://127.0.0.1:${address.port}/`],
        onProgress: (event) => progress.push(event.progress),
      });
    } finally {
      server.close();
    }

    expect(await readFile(join(root, 'model.int8.onnx'))).toEqual(body);
    expect(progress.at(-1)).toBe(1);
  });

  it('rejects a file that does not match the pinned checksum', async () => {
    const body = Buffer.from('corrupt');
    const server = createServer((_request, response) => response.end(body));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    const root = join(tmpdir(), `xopc-voice-files-bad-${process.pid}-${Date.now()}`);
    tempRoots.push(root);

    try {
      await expect(downloadLocalVoiceModelFiles({
        model: {
          id: 'sensevoice-small',
          name: 'test',
          description: 'test',
          engine: 'sherpa-onnx',
          repository: 'test/repo',
          revision: 'revision',
          files: [{ path: 'tokens.txt', bytes: body.length, sha256: '0'.repeat(64) }],
          languages: ['zh'],
          approximateBytes: body.length,
        },
        destinationDir: root,
        remoteHosts: [`http://127.0.0.1:${address.port}/`],
      })).rejects.toThrow('checksum mismatch');
    } finally {
      server.close();
    }
  });

  it('resumes an interrupted model file with an HTTP range request', async () => {
    const body = Buffer.from('0123456789-sensevoice-model');
    let requestedRange: string | undefined;
    const server = createServer((request, response) => {
      requestedRange = request.headers.range;
      const offset = Number(requestedRange?.match(/^bytes=(\d+)-$/)?.[1] ?? 0);
      const remaining = body.subarray(offset);
      response.writeHead(offset > 0 ? 206 : 200, {
        'content-length': String(remaining.length),
        ...(offset > 0 ? { 'content-range': `bytes ${offset}-${body.length - 1}/${body.length}` } : {}),
      });
      response.end(remaining);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    const root = join(tmpdir(), `xopc-voice-files-resume-${process.pid}-${Date.now()}`);
    tempRoots.push(root);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'model.int8.onnx'), body.subarray(0, 10));

    try {
      await downloadLocalVoiceModelFiles({
        model: {
          id: 'sensevoice-small',
          name: 'test',
          description: 'test',
          engine: 'sherpa-onnx',
          repository: 'test/repo',
          revision: 'revision',
          files: [{
            path: 'model.int8.onnx',
            bytes: body.length,
            sha256: createHash('sha256').update(body).digest('hex'),
          }],
          languages: ['zh'],
          approximateBytes: body.length,
        },
        destinationDir: root,
        remoteHosts: [`http://127.0.0.1:${address.port}/`],
      });
    } finally {
      server.close();
    }

    expect(requestedRange).toBe('bytes=10-');
    expect(await readFile(join(root, 'model.int8.onnx'))).toEqual(body);
  });
});

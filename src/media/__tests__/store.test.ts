import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import {
  deleteMediaBuffer,
  mimeTypeFromMediaPath,
  readMediaBuffer,
  resolveMediaBufferPath,
  saveMediaBuffer,
} from '../store.js';
import { buildMediaUri, parseMediaUri } from '../uri.js';
import { getMediaDir } from '../paths.js';

describe('media store', () => {
  let prevStateDir: string | undefined;

  afterEach(async () => {
    if (prevStateDir === undefined) {
      delete process.env.XOPC_STATE_DIR;
    } else {
      process.env.XOPC_STATE_DIR = prevStateDir;
    }
  });

  it('saveMediaBuffer writes flat id under media/inbound', async () => {
    prevStateDir = process.env.XOPC_STATE_DIR;
    const work = join(tmpdir(), `xopc-media-${Date.now()}`);
    process.env.XOPC_STATE_DIR = work;
    await mkdir(work, { recursive: true });

    const saved = await saveMediaBuffer(Buffer.from('hello'), {
      contentType: 'image/png',
      originalFilename: 'photo.png',
    });

    expect(saved.uri).toBe(buildMediaUri('inbound', saved.id));
    expect(saved.path).toBe(resolveMediaBufferPath(saved.id, 'inbound'));
    expect(saved.id).toMatch(/photo---/);

    const read = await readMediaBuffer(saved.id, 'inbound');
    expect(read.buffer.toString()).toBe('hello');

    await deleteMediaBuffer(saved.id, 'inbound');
    expect(getMediaDir()).toContain(work);
  });

  it('preserves svg extension and MIME type for browser image rendering', async () => {
    prevStateDir = process.env.XOPC_STATE_DIR;
    const work = join(tmpdir(), `xopc-media-${Date.now()}`);
    process.env.XOPC_STATE_DIR = work;
    await mkdir(work, { recursive: true });

    const saved = await saveMediaBuffer(Buffer.from('<svg/>'), {
      contentType: 'image/svg+xml; charset=utf-8',
      originalFilename: 'logo.svg',
    });

    expect(saved.id).toMatch(/logo---.+\.svg$/);
    expect(saved.contentType).toBe('image/svg+xml');
    expect(mimeTypeFromMediaPath(saved.path)).toBe('image/svg+xml');
  });

  it('parseMediaUri rejects traversal and invalid buckets', () => {
    expect(() => parseMediaUri('media://inbound/id/extra')).toThrow();
    expect(() => parseMediaUri('media://other/id')).toThrow();
  });
});

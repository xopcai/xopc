import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import {
  decodeInboundAttachmentBase64,
  persistInboundAttachments,
  readInboundAttachmentBuffer,
} from '../inbound-persist.js';
import { readMediaBuffer } from '../../../media/store.js';

describe('persistInboundAttachments', () => {
  let prevStateDir: string | undefined;

  afterEach(async () => {
    if (prevStateDir === undefined) {
      delete process.env.XOPC_STATE_DIR;
    } else {
      process.env.XOPC_STATE_DIR = prevStateDir;
    }
  });

  it('writes binary data to global media store and returns MediaRef', async () => {
    prevStateDir = process.env.XOPC_STATE_DIR;
    const work = join(tmpdir(), `xopc-inbound-${Date.now()}`);
    process.env.XOPC_STATE_DIR = work;
    await mkdir(work, { recursive: true });

    const b64 = Buffer.from('hello-doc').toString('base64');
    const prepared = await persistInboundAttachments([
      {
        type: 'document',
        mimeType: 'text/plain',
        name: 'doc.txt',
        data: b64,
      },
    ]);

    expect(prepared).toHaveLength(1);
    const att = prepared![0]!;
    expect(att.uri).toMatch(/^media:\/\/inbound\//);
    expect(att.name).toBe('doc.txt');
    expect(att.mimeType).toBe('text/plain');

    const buf = await readInboundAttachmentBuffer(att.uri);
    expect(buf.toString()).toBe('hello-doc');
  });

  it('passes through existing media URI without re-writing', async () => {
    prevStateDir = process.env.XOPC_STATE_DIR;
    const work = join(tmpdir(), `xopc-inbound-${Date.now()}`);
    process.env.XOPC_STATE_DIR = work;
    await mkdir(work, { recursive: true });

    const { saveMediaBuffer } = await import('../../../media/store.js');
    const saved = await saveMediaBuffer(Buffer.from('cached'), {
      contentType: 'image/png',
      originalFilename: 'x.png',
    });

    const prepared = await persistInboundAttachments([
      {
        type: 'photo',
        mimeType: 'image/png',
        name: 'x.png',
        uri: saved.uri,
      },
    ]);

    expect(prepared![0]!.uri).toBe(saved.uri);
    const read = await readMediaBuffer(saved.id, 'inbound');
    expect(read.buffer.toString()).toBe('cached');
    await rm(work, { recursive: true, force: true });
  });

  it('throws when attachment has neither data nor uri', async () => {
    prevStateDir = process.env.XOPC_STATE_DIR;
    process.env.XOPC_STATE_DIR = join(tmpdir(), `xopc-inbound-${Date.now()}`);
    await expect(
      persistInboundAttachments([{ type: 'document', name: 'x.txt' }]),
    ).rejects.toThrow(/missing data and uri/i);
  });

  it('decodeInboundAttachmentBase64 handles data URLs', () => {
    const buf = decodeInboundAttachmentBase64('data:text/plain;base64,aGVsbG8=');
    expect(buf.toString()).toBe('hello');
  });
});

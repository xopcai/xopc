import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { loadEnterpriseMedia } from '../enterprise/media.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('loadEnterpriseMedia', () => {
  it('loads data URLs with filename hint and treats SVG as a file attachment', async () => {
    const cfg = ConfigSchema.parse({});
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const image = await loadEnterpriseMedia(
      cfg,
      `data:application/octet-stream;base64,${pngBytes.toString('base64')}`,
      { filenameHint: 'dir/portrait.png' },
    );
    expect(image).toMatchObject({
      mimeType: 'image/png',
      filename: 'portrait.png',
      kind: 'image',
    });

    const svg = await loadEnterpriseMedia(
      cfg,
      `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
      { filenameHint: 'diagram.svg' },
    );
    expect(svg).toMatchObject({
      mimeType: 'image/svg+xml',
      filename: 'diagram.svg',
      kind: 'file',
    });
  });

  it('loads files inside the configured workspace and blocks escaping paths', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'xopc-enterprise-media-'));
    const outside = mkdtempSync(join(tmpdir(), 'xopc-enterprise-outside-'));
    vi.stubEnv('XOPC_WORKSPACE', workspace);
    try {
      writeFileSync(join(workspace, 'notes.pdf'), '%PDF-1.4\nhello');
      writeFileSync(join(outside, 'secret.txt'), 'nope');
      const cfg = ConfigSchema.parse({});

      const loaded = await loadEnterpriseMedia(cfg, 'notes.pdf');
      expect(loaded).toMatchObject({
        filename: 'notes.pdf',
        mimeType: 'application/pdf',
        kind: 'file',
      });

      await expect(loadEnterpriseMedia(cfg, join(outside, 'secret.txt'))).rejects.toThrow(/escapes allowed workspace roots/i);

      writeFileSync(join(workspace, '.env'), 'SECRET=1');
      symlinkSync(join(workspace, '.env'), join(workspace, 'alias.txt'));
      await expect(loadEnterpriseMedia(cfg, 'alias.txt')).rejects.toThrow(/not allowed|protected|env|denied|sensitive/i);
    } finally {
      vi.unstubAllEnvs();
      rmSync(workspace, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('blocks SSRF targets, unsafe redirects, and oversized remote streams', async () => {
    const cfg = ConfigSchema.parse({});
    await expect(loadEnterpriseMedia(cfg, 'http://169.254.169.254/latest/meta-data/')).rejects.toThrow();
    await expect(loadEnterpriseMedia(cfg, 'http://127.0.0.1:18790/api/config')).rejects.toThrow();

    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href === 'https://example.com/redirect.png') {
        return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
      }
      if (href === 'https://example.com/huge.bin') {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(64));
            controller.enqueue(new Uint8Array(64));
            controller.close();
          },
        });
        return new Response(stream, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
      }
      throw new Error(`Unexpected URL: ${href}`);
    }));

    await expect(loadEnterpriseMedia(cfg, 'https://example.com/redirect.png')).rejects.toThrow();
    await expect(loadEnterpriseMedia(cfg, 'https://example.com/huge.bin', { maxBytes: 100 })).rejects.toThrow(/too large/i);
  });
});

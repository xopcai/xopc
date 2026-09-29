import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveExtensionZipDownloadUrl } from '../store-api-client.js';

describe('Agent Plugin Store packages', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves a published plugin artifact with its immutable digest', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      name: 'research.plugin',
      type: 'plugin',
      latestVersion: {
        version: '1.2.3',
        downloadUrl: 'https://store.example.com/files/research.plugin.zip',
        sha256: 'a'.repeat(64),
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await expect(resolveExtensionZipDownloadUrl(
      'https://store.example.com',
      'research.plugin',
    )).resolves.toEqual({
      downloadUrl: 'https://store.example.com/files/research.plugin.zip',
      version: '1.2.3',
      integrity: 'a'.repeat(64),
      sha256: 'a'.repeat(64),
    });
  });

  it('still rejects package types that cannot be installed as extensions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      name: 'skill-only',
      type: 'skill',
      latestVersion: { version: '1.0.0' },
    }), { status: 200 })));

    await expect(resolveExtensionZipDownloadUrl(
      'https://store.example.com',
      'skill-only',
    )).rejects.toThrow(/expected plugin or extension/i);
  });
});

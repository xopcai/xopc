import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ModelCatalogPersistence } from '../model-catalog-persistence.js';
import type { CatalogSource } from '../model-catalog-store.js';

const tempDirs: string[] = [];

function fixture(): CatalogSource {
  return {
    providerId: 'xopc-cloud',
    baseUrl: 'https://router.test/v1',
    api: 'openai-completions',
    etag: 'catalog-1',
    recommendedModel: 'chat-1',
    lastSuccessAt: 123,
    models: [{
      id: 'chat-1', name: 'Chat 1', availability: 'available', kind: 'language',
      input: ['text', 'image'], output: ['text'], operations: ['chat.completions'],
      reasoning: false, contextWindow: 128_000, maxOutputTokens: 8_192,
    }],
  };
}

function createPersistence(): { persistence: ModelCatalogPersistence; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-catalog-persistence-'));
  tempDirs.push(dir);
  const path = join(dir, 'cache', 'catalog.json');
  return { persistence: new ModelCatalogPersistence(path), path };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('ModelCatalogPersistence', () => {
  it('round-trips a validated snapshot with private permissions', async () => {
    const { persistence, path } = createPersistence();
    await persistence.save(fixture());

    expect(persistence.loadSync()).toEqual(fixture());
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('rejects corrupt, unknown, and oversized snapshots', async () => {
    const { persistence, path } = createPersistence();
    await persistence.save(fixture());
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    raw.schemaVersion = 2;
    writeFileSync(path, JSON.stringify(raw));
    expect(persistence.loadSync()).toBeUndefined();

    writeFileSync(path, '{bad json');
    expect(persistence.loadSync()).toBeUndefined();

    writeFileSync(path, Buffer.alloc(4 * 1024 * 1024 + 1));
    expect(persistence.loadSync()).toBeUndefined();
    chmodSync(path, 0o600);
  });

  it('does not write a snapshot that cannot be loaded within the size limit', async () => {
    const { persistence } = createPersistence();
    const oversized = fixture();
    oversized.models[0]!.name = 'x'.repeat(4 * 1024 * 1024);

    await expect(persistence.save(oversized)).rejects.toThrow('exceeds the 4 MiB cache limit');
  });
});

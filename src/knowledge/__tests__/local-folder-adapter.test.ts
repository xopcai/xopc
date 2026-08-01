import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalFolderKnowledgeSourceAdapter } from '../local-folder-adapter.js';

describe('LocalFolderKnowledgeSourceAdapter', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('reads supported user files while excluding dependencies and unsupported binaries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-local-source-'));
    roots.push(root);
    mkdirSync(join(root, 'notes'));
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'notes', 'plan.md'), '# Plan\nShip the knowledge source.');
    writeFileSync(join(root, 'node_modules', 'ignored.md'), 'dependency');
    writeFileSync(join(root, 'image.png'), 'not really an image');
    const adapter = new LocalFolderKnowledgeSourceAdapter(root);

    const result = await adapter.pull({ instanceId: 'local-folder:local-files', signal: new AbortController().signal });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      sourceInstanceId: 'local-folder:local-files',
      externalId: 'notes/plan.md',
      itemType: 'local_file',
      authorRole: 'user',
      sensitivity: 'personal',
      retentionClass: 'durable',
    });
    expect(result.items[0]?.normalizedText).toContain('Ship the knowledge source');
    expect(result.snapshotExternalIds).toEqual(['notes/plan.md']);
  });

  it('uses the cursor for incremental reads', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-local-source-'));
    roots.push(root);
    writeFileSync(join(root, 'old.md'), 'already synced');
    const adapter = new LocalFolderKnowledgeSourceAdapter(root);

    const result = await adapter.pull({
      instanceId: 'local-folder:local-files',
      cursor: new Date(Date.now() + 1_000).toISOString(),
      signal: new AbortController().signal,
    });

    expect(result.items).toEqual([]);
  });
});

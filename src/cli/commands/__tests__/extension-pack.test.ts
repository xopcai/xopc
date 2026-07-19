import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ExtensionManifest } from '../../../extensions/types/index.js';
import { writeStoreReadyArtifact } from '../extension-pack.js';

describe('writeStoreReadyArtifact', () => {
  it('writes matching raw SHA-256 and SRI digests into Store metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-extension-pack-'));
    const extensionDir = join(root, 'source');
    const outDir = join(root, 'release');
    const manifest: ExtensionManifest = {
      id: 'pack-contract-test',
      name: 'Pack contract test',
      version: '1.2.3',
      main: 'index.js',
      engines: { xopc: '>=0.0.0' },
    };
    const packageJson = { name: 'pack-contract-test', version: '1.2.3' };

    try {
      mkdirSync(extensionDir);
      writeFileSync(join(extensionDir, 'xopc.extension.json'), JSON.stringify(manifest));
      writeFileSync(join(extensionDir, 'package.json'), JSON.stringify(packageJson));
      writeFileSync(join(extensionDir, 'index.js'), 'export default {}\n');

      const zipPath = writeStoreReadyArtifact({ extensionDir, outDir, manifest, packageJson });
      const buffer = readFileSync(zipPath);
      const rawSha256 = createHash('sha256').update(buffer).digest('hex');
      const sri = `sha256-${createHash('sha256').update(buffer).digest('base64')}`;
      const metadata = JSON.parse(
        readFileSync(join(outDir, 'pack-contract-test-1.2.3.manifest.json'), 'utf8'),
      ) as { artifact: string; sha256: string; integrity: string };

      expect(metadata).toMatchObject({
        artifact: basename(zipPath),
        sha256: rawSha256,
        integrity: sri,
      });
      expect(readFileSync(join(outDir, 'pack-contract-test-1.2.3.sha256'), 'utf8'))
        .toBe(`${rawSha256}  ${basename(zipPath)}\n`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

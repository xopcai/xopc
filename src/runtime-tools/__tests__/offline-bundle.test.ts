import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveOfflineBundleArtifact } from '../offline-bundle.js';

describe('offline runtime bundle', () => {
  it('requires and verifies a checksum before returning an archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xopc-offline-runtime-'));
    try {
      const archiveFile = 'node-test.tar.gz';
      const content = Buffer.from('runtime archive');
      const checksum = createHash('sha256').update(content).digest('hex');
      await writeFile(join(root, archiveFile), content);
      await writeFile(join(root, `${archiveFile}.sha256`), `${checksum}  ${archiveFile}\n`);

      await expect(resolveOfflineBundleArtifact({
        bundleDir: root,
        runtime: 'node',
        archiveFile,
      })).resolves.toMatchObject({ archiveFile, sha256: checksum });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

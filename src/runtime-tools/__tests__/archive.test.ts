import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';

import { extractRuntimeArchive } from '../archive.js';

describe('runtime archive extraction', () => {
  it('rejects path traversal members', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xopc-runtime-archive-'));
    const archive = join(root, 'bad.zip');
    const zip = new AdmZip();
    zip.addFile('../escape', Buffer.from('unsafe'));
    await writeFile(archive, zip.toBuffer());

    await expect(extractRuntimeArchive({
      runtime: 'uv',
      archivePath: archive,
      archiveType: 'zip',
      stagingDir: join(root, 'staging'),
    })).rejects.toMatchObject({ code: 'RUNTIME_ARCHIVE_INVALID' });
  });
});

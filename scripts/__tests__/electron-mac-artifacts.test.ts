import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import yaml from 'js-yaml';
import { expect, it } from 'vitest';

it('refreshes both updater hashes and blockmaps after artifact bytes change', () => {
  const root = mkdtempSync(join(tmpdir(), 'xopc-mac-artifacts-test-'));
  try {
    const files = [{ url: 'xopc.zip', bytes: Buffer.from('signed app with stapled ticket') }, { url: 'xopc.dmg', bytes: Buffer.from('signed DMG with stapled ticket') }];
    for (const file of files) writeFileSync(join(root, file.url), file.bytes);
    writeFileSync(join(root, 'latest-mac.yml'), yaml.dump({ version: '0.0.1', path: 'xopc.zip', sha512: 'stale', files: files.map(file => ({ url: file.url, sha512: 'stale', size: 0 })) }));
    const result = spawnSync(process.execPath, [resolve('scripts/refresh-electron-mac-artifacts.mjs'), root], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const metadata = yaml.load(readFileSync(join(root, 'latest-mac.yml'), 'utf8')) as { sha512: string; files: Array<{ url: string; sha512: string; size: number }> };
    for (const file of files) {
      const expected = createHash('sha512').update(file.bytes).digest('base64');
      expect(metadata.files.find(entry => entry.url === file.url)).toMatchObject({ size: file.bytes.length, sha512: expected });
      const blockmap = JSON.parse(gunzipSync(readFileSync(join(root, file.url + '.blockmap'))).toString()) as { files: Array<{ sizes: number[] }> };
      expect(blockmap.files[0].sizes.reduce((sum, size) => sum + size, 0)).toBe(file.bytes.length);
    }
    expect(metadata.sha512).toBe(metadata.files[0].sha512);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';

type UpdateManifest = {
  version: string;
  files: Array<{ url: string; sha512: string; size: number }>;
  path: string;
  sha512: string;
  releaseDate: string;
};

describe('merge-macos-electron-latest-yml', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function createManifest(root: string, arch: 'x64' | 'arm64', version = '1.2.3') {
    const zip = `xopc-${version}-${arch}.zip`;
    const manifest: UpdateManifest = {
      version,
      files: [
        { url: zip, sha512: `${arch}-zip-sha`, size: 100 },
        { url: `xopc-${version}-${arch}.dmg`, sha512: `${arch}-dmg-sha`, size: 200 },
      ],
      path: zip,
      sha512: `${arch}-zip-sha`,
      releaseDate: arch === 'x64' ? '2026-09-09T10:00:00.000Z' : '2026-09-09T10:05:00.000Z',
    };
    const path = join(root, `latest-mac-${arch}.yml`);
    writeFileSync(path, yaml.dump(manifest));
    return path;
  }

  it('merges x64 and arm64 artifacts into one latest-mac manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-mac-manifest-'));
    roots.push(root);
    const x64Path = createManifest(root, 'x64');
    const arm64Path = createManifest(root, 'arm64');

    execFileSync(process.execPath, [
      'scripts/merge-macos-electron-latest-yml.mjs',
      x64Path,
      arm64Path,
      arm64Path,
    ]);

    const merged = yaml.load(readFileSync(arm64Path, 'utf8')) as UpdateManifest;
    expect(merged.files.map((file) => file.url)).toEqual([
      'xopc-1.2.3-x64.zip',
      'xopc-1.2.3-x64.dmg',
      'xopc-1.2.3-arm64.zip',
      'xopc-1.2.3-arm64.dmg',
    ]);
    expect(merged.path).toBe('xopc-1.2.3-x64.zip');
    expect(merged.releaseDate).toBe('2026-09-09T10:05:00.000Z');
  });

  it('rejects manifests from different versions', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-mac-manifest-'));
    roots.push(root);
    const result = spawnSync(
      process.execPath,
      [
        'scripts/merge-macos-electron-latest-yml.mjs',
        createManifest(root, 'x64', '1.2.3'),
        createManifest(root, 'arm64', '1.2.4'),
        join(root, 'latest-mac.yml'),
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Version mismatch across macOS update manifests');
  });
});

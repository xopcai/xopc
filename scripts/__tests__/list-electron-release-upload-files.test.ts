import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

describe('list-electron-release-upload-files', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('lists installers and update manifests but excludes helper executables', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-electron-release-files-'));
    roots.push(root);
    const files = [
      'windows/xopc-0.0.222-x64.exe',
      'windows/latest.yml',
      'linux/xopc-0.0.222-x86_64.AppImage',
      'mac/xopc-0.0.222-arm64.dmg',
      'windows/__uninstaller-nsis-xopc/OpenConsole.exe',
      'windows/__uninstaller-nsis-xopc/voice-hotkey-helper.exe',
      'windows/win-unpacked/xopc.exe',
    ];
    for (const file of files) {
      const path = join(root, file);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, 'fixture');
    }

    const output = execFileSync('bash', ['scripts/list-electron-release-upload-files.sh', root], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(output.trim().split('\n').map((path) => relative(root, path))).toEqual([
      'linux/xopc-0.0.222-x86_64.AppImage',
      'mac/xopc-0.0.222-arm64.dmg',
      'windows/latest.yml',
      'windows/xopc-0.0.222-x64.exe',
    ]);
  });
});

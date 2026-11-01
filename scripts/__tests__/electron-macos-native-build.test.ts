import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../..', import.meta.url));

describe.skipIf(process.platform !== 'darwin')('macOS release native architectures', () => {
  it.each([
    ['build-desktop-workspace.mjs', 'desktop-workspace-macos.cc', 'desktop-workspace.node'],
    ['build-voice-hotkey-helper.mjs', 'voice-hotkey-macos.swift', 'voice-hotkey-helper'],
  ])('builds %s with both Intel and Apple Silicon slices', (script, source, binary) => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-native-release-'));
    try {
      mkdirSync(join(root, 'scripts'), { recursive: true });
      mkdirSync(join(root, 'electron/native'), { recursive: true });
      cpSync(join(repo, 'scripts', script), join(root, 'scripts', script));
      cpSync(join(repo, 'electron/native', source), join(root, 'electron/native', source));
      const args = [join(root, 'scripts', script)];
      if (binary.endsWith('.node')) args.push('--headers', join(dirname(process.execPath), '../include/node'));
      const built = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 90_000 });
      expect(built.status, built.error?.message ?? `${built.stdout}\n${built.stderr}`).toBe(0);
      const output = join(root, 'dist/electron/native', binary);
      const checked = spawnSync('lipo', [output, '-verify_arch', 'x86_64', 'arm64'], { encoding: 'utf8' });
      expect(checked.status, checked.stderr).toBe(0);
      if (binary.endsWith('.node')) {
        const native = createRequire(import.meta.url)(output);
        expect(typeof native.openRoot).toBe('function');
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 120_000);
});

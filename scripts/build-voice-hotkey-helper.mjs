#!/usr/bin/env node
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const outputDir = join(root, 'dist/electron/native');
mkdirSync(outputDir, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`[build-voice-hotkey-helper] ${command} failed with exit code ${result.status ?? 1}`);
  }
}

if (process.platform === 'darwin') {
  const output = join(outputDir, 'voice-hotkey-helper');
  rmSync(output, { force: true });
  run('swiftc', [
    join(root, 'electron/native/voice-hotkey-macos.swift'),
    '-framework', 'AppKit',
    '-framework', 'ApplicationServices',
    '-O',
    '-o', output,
  ]);
  console.log(`[build-voice-hotkey-helper] Built ${output}`);
} else if (process.platform === 'win32') {
  const output = join(outputDir, 'voice-hotkey-helper.exe');
  rmSync(output, { force: true });
  run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', join(root, 'scripts/build-voice-hotkey-helper.ps1'),
    '-Source', join(root, 'electron/native/voice-hotkey-windows.cs'),
    '-Output', output,
  ]);
  console.log(`[build-voice-hotkey-helper] Built ${output}`);
} else {
  console.log('[build-voice-hotkey-helper] No native voice hotkey on this platform');
}

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

import { app } from 'electron';

type VoiceHotkey = 'fn' | 'alt';

type VoiceHotkeyProcess = ChildProcessByStdio<null, Readable, Readable>;

let helper: VoiceHotkeyProcess | null = null;

export function parseVoiceHotkeyHelperLine(line: string): VoiceHotkey | null {
  try {
    const payload = JSON.parse(line) as { type?: unknown; key?: unknown };
    if (payload.type !== 'modifier-tap') return null;
    return payload.key === 'fn' || payload.key === 'alt' ? payload.key : null;
  } catch {
    return null;
  }
}

function helperPath(): string | null {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return null;
  const name = process.platform === 'win32' ? 'voice-hotkey-helper.exe' : 'voice-hotkey-helper';
  const path = app.isPackaged
    ? join(process.resourcesPath, 'bin', name)
    : join(app.getAppPath(), 'dist', 'electron', 'native', name);
  return existsSync(path) ? path : null;
}

export function startVoiceInputHotkey(onTap: (key: VoiceHotkey) => void): void {
  if (helper) return;
  const path = helperPath();
  if (!path) {
    if (process.platform === 'darwin' || process.platform === 'win32') {
      console.warn('[VoiceInputHotkey] Native helper is unavailable');
    }
    return;
  }

  const current = spawn(path, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  helper = current;
  const lines = createInterface({ input: current.stdout });
  lines.on('line', (line) => {
    const key = parseVoiceHotkeyHelperLine(line);
    if (key) onTap(key);
  });
  current.stderr.on('data', (chunk) => {
    const message = String(chunk).trim();
    if (message) console.warn(`[VoiceInputHotkey] ${message}`);
  });
  current.on('error', (err) => {
    console.warn(`[VoiceInputHotkey] Helper failed: ${err.message}`);
  });
  current.on('exit', (code, signal) => {
    if (helper === current) helper = null;
    if (code && code !== 0) {
      console.warn(`[VoiceInputHotkey] Helper exited: code=${code}, signal=${signal ?? 'none'}`);
    }
  });
}

export function stopVoiceInputHotkey(): void {
  const current = helper;
  helper = null;
  if (current && !current.killed) current.kill();
}

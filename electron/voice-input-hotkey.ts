import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

import { app } from 'electron';

export type VoiceHotkeyEvent = {
  action: 'press' | 'release';
  key: 'fn' | 'alt';
};

type VoiceHotkeyProcess = ChildProcessByStdio<null, Readable, Readable>;

let helper: VoiceHotkeyProcess | null = null;
let helperRetryTimer: ReturnType<typeof setTimeout> | null = null;
let helperUnavailableWarned = false;
let helperStopping = false;

function scheduleHelperRetry(onEvent: (event: VoiceHotkeyEvent) => void): void {
  if (app.isPackaged || helperRetryTimer) return;
  helperRetryTimer = setTimeout(() => {
    helperRetryTimer = null;
    startVoiceInputHotkey(onEvent);
  }, 1_000);
  helperRetryTimer.unref();
}

export function parseVoiceHotkeyHelperLine(line: string): VoiceHotkeyEvent | null {
  try {
    const payload = JSON.parse(line) as { type?: unknown; action?: unknown; key?: unknown };
    if (payload.type !== 'modifier-hold') return null;
    if (payload.action !== 'press' && payload.action !== 'release') return null;
    if (payload.key !== 'fn' && payload.key !== 'alt') return null;
    return { action: payload.action, key: payload.key };
  } catch {
    return null;
  }
}

export function resolveVoiceInputHotkeyHelperPath(options: {
  platform: NodeJS.Platform;
  packaged: boolean;
  resourcesPath: string;
  mainDir: string;
}): string | null {
  if (options.platform !== 'darwin' && options.platform !== 'win32') return null;
  const name = options.platform === 'win32' ? 'voice-hotkey-helper.exe' : 'voice-hotkey-helper';
  return options.packaged
    ? join(options.resourcesPath, 'bin', name)
    : join(options.mainDir, '..', '..', 'dist', 'electron', 'native', name);
}

function helperPath(): string | null {
  const path = resolveVoiceInputHotkeyHelperPath({
    platform: process.platform,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    mainDir: import.meta.dirname,
  });
  if (!path) return null;
  return existsSync(path) ? path : null;
}

export function startVoiceInputHotkey(onEvent: (event: VoiceHotkeyEvent) => void): void {
  helperStopping = false;
  if (helper) return;
  const path = helperPath();
  if (!path) {
    if (!helperUnavailableWarned && (process.platform === 'darwin' || process.platform === 'win32')) {
      console.warn('[VoiceInputHotkey] Native helper is unavailable');
      helperUnavailableWarned = true;
    }
    scheduleHelperRetry(onEvent);
    return;
  }

  helperUnavailableWarned = false;
  const current = spawn(path, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  helper = current;
  const lines = createInterface({ input: current.stdout });
  lines.on('line', (line) => {
    const event = parseVoiceHotkeyHelperLine(line);
    if (event) onEvent(event);
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
    if (!helperStopping) scheduleHelperRetry(onEvent);
  });
}

export function stopVoiceInputHotkey(): void {
  helperStopping = true;
  if (helperRetryTimer) {
    clearTimeout(helperRetryTimer);
    helperRetryTimer = null;
  }
  const current = helper;
  helper = null;
  if (current && !current.killed) current.kill();
}

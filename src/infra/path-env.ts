import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveBrewPathDirs } from './brew.js';

type EnsureXopcPathOpts = {
  execPath?: string;
  cwd?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  pathEnv?: string;
};

function isTruthyEnvValue(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function mergePath(params: { existing: string; prepend?: string[]; append?: string[] }): string {
  const partsExisting = params.existing
    .split(path.delimiter)
    .map((part) => part.trim())
    .filter(Boolean);
  const partsPrepend = (params.prepend ?? []).map((part) => part.trim()).filter(Boolean);
  const partsAppend = (params.append ?? []).map((part) => part.trim()).filter(Boolean);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const part of [...partsPrepend, ...partsExisting, ...partsAppend]) {
    if (seen.has(part)) continue;
    seen.add(part);
    merged.push(part);
  }
  return merged.join(path.delimiter);
}

function candidateBinDirs(opts: EnsureXopcPathOpts): { prepend: string[]; append: string[] } {
  const execPath = opts.execPath ?? process.execPath;
  const homeDir = opts.homeDir ?? os.homedir();
  const platform = opts.platform ?? process.platform;
  const prepend: string[] = [];
  const append: string[] = [];

  try {
    const execDir = path.dirname(execPath);
    if (isExecutable(execPath)) prepend.push(execDir);
  } catch {
    // ignore
  }

  try {
    const execDir = path.dirname(execPath);
    const siblingCli = path.join(execDir, 'xopc');
    if (isExecutable(siblingCli)) prepend.push(execDir);
  } catch {
    // ignore
  }

  prepend.push('/usr/bin', '/bin');
  append.push(...resolveBrewPathDirs({ homeDir }));
  if (platform === 'darwin') append.push(path.join(homeDir, 'Library', 'pnpm'));
  if (process.env.XDG_BIN_HOME) append.push(process.env.XDG_BIN_HOME);
  append.push(
    path.join(homeDir, '.local', 'bin'),
    path.join(homeDir, '.local', 'share', 'pnpm'),
    path.join(homeDir, '.bun', 'bin'),
    path.join(homeDir, '.nvm', 'versions', 'node'),
  );

  return { prepend: prepend.filter(isDirectory), append: append.filter(isDirectory) };
}

/** Bootstrap PATH for launchd/daemon environments (npm/pnpm/git subprocesses). */
export function ensureXopcCliOnPath(opts: EnsureXopcPathOpts = {}): void {
  if (isTruthyEnvValue(process.env.XOPC_PATH_BOOTSTRAPPED)) return;
  process.env.XOPC_PATH_BOOTSTRAPPED = '1';

  const existing = opts.pathEnv ?? process.env.PATH ?? '';
  const { prepend, append } = candidateBinDirs(opts);
  if (prepend.length === 0 && append.length === 0) return;

  const merged = mergePath({ existing, prepend, append });
  if (merged) process.env.PATH = merged;
}

export function resolveExecPathBinPrepend(): string[] {
  const execPath = process.execPath?.trim();
  if (!execPath) return [];
  const execDir = path.dirname(execPath);
  return isDirectory(execDir) ? [execDir] : [];
}

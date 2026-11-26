import { accessSync, constants as fsConstants, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, extname, isAbsolute, join, resolve } from 'node:path';

import { resolveUserPath } from '../agent-scope.js';

export type HostExecutableCandidate = {
  path: string;
  mtimeMs: number;
};

export function statExecutableFile(candidate: string): { mtimeMs: number } | undefined {
  try {
    const stat = statSync(candidate);
    if (!stat.isFile()) return undefined;
    if (process.platform !== 'win32') accessSync(candidate, fsConstants.X_OK);
    return { mtimeMs: stat.mtimeMs };
  } catch {
    return undefined;
  }
}

export function isHostExecutableFile(candidate: string): boolean {
  return Boolean(statExecutableFile(candidate));
}

function collectNvmBinDirs(home: string): string[] {
  const versionsDir = join(home, '.nvm', 'versions', 'node');
  try {
    const entries = readdirSync(versionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (entries.length === 0) return [];
    const dirs: string[] = [];
    try {
      const alias = readFileSync(join(home, '.nvm', 'alias', 'default'), 'utf8').trim();
      if (alias) {
        const matched = entries.find((name) => name === alias || name === `v${alias}` || name.startsWith(alias.startsWith('v') ? alias : `v${alias}`));
        if (matched) dirs.push(join(versionsDir, matched, 'bin'));
      }
    } catch {
      // Best-effort alias resolution.
    }
    for (const version of entries.slice(0, 3)) {
      const binDir = join(versionsDir, version, 'bin');
      if (!dirs.includes(binDir)) dirs.push(binDir);
    }
    return dirs;
  } catch {
    return [];
  }
}

/**
 * Common host CLI installation directories outside launchd/GUI default PATH
 * (Homebrew, npm/pnpm/volta/bun/cargo globals, nvm/fnm/mise shims, Windows user bins).
 */
export function collectFallbackSearchDirs(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string[] {
  if (platform === 'win32') {
    const dirs: string[] = [];
    const appData = env.APPDATA?.trim();
    const localAppData = env.LOCALAPPDATA?.trim();
    const userProfile = env.USERPROFILE?.trim() || home;
    if (appData) dirs.push(join(appData, 'npm'));
    if (localAppData) {
      dirs.push(join(localAppData, 'pnpm'));
      dirs.push(join(localAppData, 'Programs'));
      dirs.push(join(localAppData, 'Volta', 'bin'));
    }
    if (userProfile) {
      dirs.push(join(userProfile, '.local', 'bin'));
      dirs.push(join(userProfile, '.bun', 'bin'));
      dirs.push(join(userProfile, '.cargo', 'bin'));
      dirs.push(join(userProfile, '.volta', 'bin'));
    }
    return dirs;
  }

  return [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.pnpm-global', 'bin'),
    ...(platform === 'darwin' ? [join(home, 'Library', 'pnpm')] : [join(home, '.local', 'share', 'pnpm')]),
    join(home, '.volta', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.cargo', 'bin'),
    join(home, '.local', 'share', 'mise', 'shims'),
    join(home, '.asdf', 'shims'),
    join(home, '.fnm', 'current', 'bin'),
    ...collectNvmBinDirs(home),
  ];
}

function resolveExtensions(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32' || extname(name)) return [''];
  const pathext = (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean);
  return ['', ...pathext];
}

export type FindHostExecutableOptions = {
  names: ReadonlyArray<string>;
  configuredPath?: string;
  envVar?: string;
  extraSearchDirs?: ReadonlyArray<string>;
  extraExecutablePaths?: ReadonlyArray<string>;
  includeFallbackDirs?: boolean;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
};

/**
 * Collect all matching executable candidates on the host, preserving search order:
 * explicit path/env override (exclusive) -> env.PATH -> extraSearchDirs -> fallback dirs -> extraExecutablePaths.
 */
export function collectHostExecutableCandidates(options: FindHostExecutableOptions): HostExecutableCandidate[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const pathDirs = (env.PATH ?? '').split(delimiter).filter(Boolean);

  const explicitRaw = options.configuredPath?.trim()
    || (options.envVar ? env[options.envVar]?.trim() : undefined);
  if (explicitRaw) {
    const resolved = explicitRaw.includes('/') || explicitRaw.includes('\\') || explicitRaw.startsWith('~')
      ? resolveUserPath(explicitRaw)
      : explicitRaw;
    if (isAbsolute(resolved)) {
      const stat = statExecutableFile(resolved);
      return stat ? [{ path: resolved, mtimeMs: stat.mtimeMs }] : [];
    }
    const exts = resolveExtensions(resolved, env, platform);
    const matches: HostExecutableCandidate[] = [];
    const seen = new Set<string>();
    for (const dir of pathDirs) {
      for (const ext of exts) {
        const candidate = resolve(dir, `${resolved}${ext}`);
        if (seen.has(candidate)) continue;
        const stat = statExecutableFile(candidate);
        if (!stat) continue;
        seen.add(candidate);
        matches.push({ path: candidate, mtimeMs: stat.mtimeMs });
      }
    }
    return matches;
  }

  const searchDirs: string[] = [];
  const seenDirs = new Set<string>();
  const addDir = (dir: string) => {
    const trimmed = dir.trim();
    if (!trimmed) return;
    const normalized = resolve(trimmed);
    if (seenDirs.has(normalized)) return;
    seenDirs.add(normalized);
    searchDirs.push(normalized);
  };

  for (const dir of pathDirs) addDir(dir);
  for (const dir of options.extraSearchDirs ?? []) addDir(dir);
  if (options.includeFallbackDirs !== false) {
    for (const dir of collectFallbackSearchDirs(env, platform, home)) addDir(dir);
  }

  const candidates: HostExecutableCandidate[] = [];
  const seenFiles = new Set<string>();
  const addCandidate = (candidatePath: string) => {
    const normalized = resolve(candidatePath);
    if (seenFiles.has(normalized)) return;
    const stat = statExecutableFile(normalized);
    if (!stat) return;
    seenFiles.add(normalized);
    candidates.push({ path: normalized, mtimeMs: stat.mtimeMs });
  };

  for (const dir of searchDirs) {
    for (const name of options.names) {
      for (const ext of resolveExtensions(name, env, platform)) {
        addCandidate(resolve(dir, `${name}${ext}`));
      }
    }
  }
  for (const extraPath of options.extraExecutablePaths ?? []) {
    addCandidate(extraPath);
  }

  return candidates;
}

export function findHostExecutable(options: FindHostExecutableOptions): string | undefined {
  return collectHostExecutableCandidates(options)[0]?.path;
}

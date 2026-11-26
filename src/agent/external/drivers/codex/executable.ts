import { execFileSync } from 'node:child_process';
import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, extname, isAbsolute, join, resolve } from 'node:path';

import { resolveUserPath } from '../../../agent-scope.js';

type ParsedCodexVersion = {
  major: number;
  minor: number;
  patch: number;
  isPrerelease: boolean;
  prerelease: string;
};

const versionCache = new Map<string, ParsedCodexVersion | null>();

function executableStat(candidate: string): { mtimeMs: number } | undefined {
  try {
    const stat = statSync(candidate);
    if (!stat.isFile()) return undefined;
    if (process.platform !== 'win32') accessSync(candidate, fsConstants.X_OK);
    return { mtimeMs: stat.mtimeMs };
  } catch {
    return undefined;
  }
}

function isExecutableFile(candidate: string): boolean {
  return Boolean(executableStat(candidate));
}

export function parseCodexVersion(raw: string): ParsedCodexVersion | null {
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    isPrerelease: Boolean(match[4]),
    prerelease: match[4] ?? '',
  };
}

export function compareCodexVersions(a: ParsedCodexVersion | null, b: ParsedCodexVersion | null): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.isPrerelease !== b.isPrerelease) return a.isPrerelease ? -1 : 1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

function readCodexBinaryVersion(candidate: string, mtimeMs: number): ParsedCodexVersion | null {
  const key = `${candidate}:${mtimeMs}`;
  if (versionCache.has(key)) return versionCache.get(key) ?? null;
  try {
    const stdout = execFileSync(candidate, ['--version'], {
      encoding: 'utf8',
      timeout: 2_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = parseCodexVersion(stdout.trim());
    versionCache.set(key, parsed);
    return parsed;
  } catch {
    versionCache.set(key, null);
    return null;
  }
}

function macOsBundledCodexCandidates(): string[] {
  if (process.platform !== 'darwin') return [];
  const home = homedir();
  return [
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    join(home, 'Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'),
    join(home, 'Applications/Codex.app/Contents/Resources/codex'),
  ];
}

export function findCodexExecutable(configuredPath?: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = configuredPath?.trim() || env.XOPC_CODEX_BIN?.trim();
  if (raw) {
    const resolved = raw.includes('/') || raw.includes('\\') || raw.startsWith('~')
      ? resolveUserPath(raw)
      : raw;
    if (isAbsolute(resolved)) return isExecutableFile(resolved) ? resolved : undefined;
    const exts = process.platform === 'win32' && !extname(resolved)
      ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)]
      : [''];
    for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
      for (const ext of exts) {
        const candidate = resolve(dir, `${resolved}${ext}`);
        if (isExecutableFile(candidate)) return candidate;
      }
    }
    return undefined;
  }

  const exts = process.platform === 'win32'
    ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)]
    : [''];
  const candidates: Array<{ path: string; mtimeMs: number }> = [];
  const seen = new Set<string>();
  const addCandidate = (candidatePath: string) => {
    const normalized = resolve(candidatePath);
    if (seen.has(normalized)) return;
    const stat = executableStat(normalized);
    if (!stat) return;
    seen.add(normalized);
    candidates.push({ path: normalized, mtimeMs: stat.mtimeMs });
  };

  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      addCandidate(resolve(dir, `codex${ext}`));
    }
  }
  for (const bundled of macOsBundledCodexCandidates()) {
    addCandidate(bundled);
  }

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0]!.path;

  // Prefer the newest Codex CLI version so newer server-gated models (e.g. GPT-6.x) are available.
  let best = candidates[0]!;
  let bestVersion = readCodexBinaryVersion(best.path, best.mtimeMs);
  for (let i = 1; i < candidates.length; i += 1) {
    const next = candidates[i]!;
    const nextVersion = readCodexBinaryVersion(next.path, next.mtimeMs);
    if (compareCodexVersions(nextVersion, bestVersion) > 0) {
      best = next;
      bestVersion = nextVersion;
    }
  }
  return best.path;
}

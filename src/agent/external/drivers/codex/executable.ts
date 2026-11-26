import { homedir } from 'node:os';
import { join } from 'node:path';

import { readProcessStdoutSync } from '../../../../process/run-process.js';
import { collectHostExecutableCandidates } from '../../executable-search.js';

type ParsedCodexVersion = {
  major: number;
  minor: number;
  patch: number;
  isPrerelease: boolean;
  prerelease: string;
};

const versionCache = new Map<string, ParsedCodexVersion | null>();

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
    const stdout = readProcessStdoutSync({ program: candidate, args: ['--version'], timeoutMs: 2_000 });
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
  const candidates = collectHostExecutableCandidates({
    names: ['codex'],
    configuredPath,
    envVar: 'XOPC_CODEX_BIN',
    extraExecutablePaths: macOsBundledCodexCandidates(),
    env,
  });

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

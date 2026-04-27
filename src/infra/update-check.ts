// src/infra/update-check.ts

import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PACKAGE_VERSION } from '../package-version.js';

import { channelToNpmTag, type UpdateChannel } from './update-channels.js';

// --- Types ---

export type InstallKind = 'git' | 'package' | 'unknown';

export type NpmTagResult = {
  tag: string;
  version: string | null;
  error?: string;
};

export type UpdateCheckResult = {
  installKind: InstallKind;
  root: string | null;
};

export type UpdateAvailable = {
  currentVersion: string;
  latestVersion: string;
  channel: string;
};

// --- npm Registry ---

const REGISTRY_BASE = 'https://registry.npmjs.org';
const PACKAGE_NAME = '@xopcai/xopc';
const REGISTRY_TIMEOUT_MS = 3500;
const MAX_REGISTRY_RETRIES = 2;
const INITIAL_REGISTRY_RETRY_DELAY_MS = 500;

/**
 * Fetch the version published under a specific npm dist-tag.
 * Uses the abbreviated packument endpoint: `GET /<pkg>/<tag>`.
 */
export async function fetchNpmTagVersion(params: {
  tag: string;
  timeoutMs?: number;
}): Promise<NpmTagResult> {
  const timeoutMs = params.timeoutMs ?? REGISTRY_TIMEOUT_MS;
  const encodedName = encodeURIComponent(PACKAGE_NAME).replace('%40', '@');
  const url = `${REGISTRY_BASE}/${encodedName}/${encodeURIComponent(params.tag)}`;

  let lastError: string | undefined;

  for (let attempt = 0; attempt <= MAX_REGISTRY_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = INITIAL_REGISTRY_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delayMs));
    }

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        if (response.status >= 400 && response.status < 500) {
          return { tag: params.tag, version: null, error: lastError };
        }
        continue;
      }
      const json = (await response.json()) as { version?: unknown };
      const version = typeof json?.version === 'string' ? json.version : null;
      return { tag: params.tag, version };
    } catch (err) {
      lastError = String(err);
    }
  }

  return { tag: params.tag, version: null, error: lastError };
}

/**
 * Resolve the best version for the given update channel.
 * For beta channel: if the beta tag version is older than latest, return latest instead.
 */
export async function resolveNpmChannelTag(params: {
  channel: UpdateChannel;
  timeoutMs?: number;
}): Promise<{ tag: string; version: string | null }> {
  const channelTag = channelToNpmTag(params.channel);
  const channelResult = await fetchNpmTagVersion({ tag: channelTag, timeoutMs: params.timeoutMs });

  if (params.channel !== 'beta') {
    return { tag: channelTag, version: channelResult.version };
  }

  // For beta: also check latest, return whichever is newer
  const latestResult = await fetchNpmTagVersion({ tag: 'latest', timeoutMs: params.timeoutMs });
  if (!latestResult.version) {
    return { tag: channelTag, version: channelResult.version };
  }
  if (!channelResult.version) {
    return { tag: 'latest', version: latestResult.version };
  }
  const comparison = compareSemver(channelResult.version, latestResult.version);
  if (comparison !== null && comparison < 0) {
    return { tag: 'latest', version: latestResult.version };
  }
  return { tag: channelTag, version: channelResult.version };
}

// --- Semver comparison ---

/**
 * Parse a version string into comparable numeric parts.
 * Handles formats like "1.2.3", "1.2.3-beta.1".
 * Returns null for unparseable strings.
 */
function parseSemverParts(
  version: string,
): { major: number; minor: number; patch: number; prerelease: string | null } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version.trim());
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] ?? null,
  };
}

/**
 * Compare two semver strings. Returns:
 * -1 if a < b, 0 if equal, 1 if a > b, null if either is unparseable.
 * Prerelease versions are considered older than the same version without prerelease.
 */
export function compareSemver(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const parsedA = parseSemverParts(a);
  const parsedB = parseSemverParts(b);
  if (!parsedA || !parsedB) return null;

  for (const field of ['major', 'minor', 'patch'] as const) {
    if (parsedA[field] !== parsedB[field]) {
      return parsedA[field] < parsedB[field] ? -1 : 1;
    }
  }

  // Both have same major.minor.patch — compare prerelease
  if (parsedA.prerelease === null && parsedB.prerelease === null) return 0;
  if (parsedA.prerelease !== null && parsedB.prerelease === null) return -1; // pre < release
  if (parsedA.prerelease === null && parsedB.prerelease !== null) return 1;

  return comparePrereleaseIdentifiers(parsedA.prerelease!, parsedB.prerelease!);
}

/**
 * Compare prerelease strings per semver 2.0 §11.
 */
function comparePrereleaseIdentifiers(a: string, b: string): number {
  const partsA = a.split('.');
  const partsB = b.split('.');
  const length = Math.min(partsA.length, partsB.length);

  for (let i = 0; i < length; i++) {
    const segA = partsA[i]!;
    const segB = partsB[i]!;
    if (segA === segB) continue;

    const numA = /^\d+$/.test(segA) ? parseInt(segA, 10) : null;
    const numB = /^\d+$/.test(segB) ? parseInt(segB, 10) : null;

    if (numA !== null && numB !== null) {
      return numA < numB ? -1 : 1;
    }
    if (numA !== null && numB === null) return -1;
    if (numA === null && numB !== null) return 1;
    return segA < segB ? -1 : 1;
  }

  if (partsA.length !== partsB.length) {
    return partsA.length < partsB.length ? -1 : 1;
  }
  return 0;
}

// --- Install kind detection ---

/**
 * Detect whether the current process is running from a git checkout or npm-installed package.
 * Checks for `.git` directory in the package root.
 */
export async function detectInstallKind(packageRoot: string): Promise<InstallKind> {
  try {
    await access(join(packageRoot, '.git'));
    return 'git';
  } catch {
    // No .git directory — likely installed via npm
    try {
      await access(join(packageRoot, 'package.json'));
      return 'package';
    } catch {
      return 'unknown';
    }
  }
}

/**
 * Resolve the xopc package root directory.
 * Walks up from this file to find package.json with name @xopcai/xopc.
 */
export async function resolvePackageRoot(): Promise<string | null> {
  let current = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 20; depth++) {
    const pkgPath = join(current, 'package.json');
    try {
      const raw = await readFile(pkgPath, 'utf-8');
      const parsed = JSON.parse(raw) as { name?: unknown };
      if (typeof parsed.name === 'string' && parsed.name === PACKAGE_NAME) {
        return current;
      }
    } catch {
      // continue
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/** Get the current running version from package.json. */
export function getCurrentVersion(): string {
  return PACKAGE_VERSION;
}

/**
 * Path safety validation for sandbox isolation.
 *
 * Prevents path traversal to sensitive directories and detects symlink escape attempts.
 * Aligned with OpenClaw's validate-sandbox-security.ts blocked-path approach.
 */

import { realpathSync } from 'node:fs';
import { isAbsolute, normalize, posix, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

import type { PathValidationResult } from './types.js';

// ---------------------------------------------------------------------------
// Blocked paths — system directories and credential stores
// ---------------------------------------------------------------------------

const BLOCKED_ABSOLUTE_PATHS: readonly string[] = [
  '/etc',
  '/proc',
  '/sys',
  '/dev',
  '/boot',
  '/root',
  '/run',
  '/var/run',
  // macOS equivalents
  '/private/etc',
  '/private/var/run',
  // Docker socket
  '/var/run/docker.sock',
  '/private/var/run/docker.sock',
  '/run/docker.sock',
];

const BLOCKED_HOME_SUBPATHS: readonly string[] = [
  '.ssh',
  '.aws',
  '.gnupg',
  '.docker',
  '.config',
  '.netrc',
  '.npmrc',
  '.cargo/credentials',
  '.kube',
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normalizePosixPath(raw: string): string {
  const slashPath = raw.replace(/\\/g, '/');
  if (slashPath.startsWith('/')) {
    return posix.normalize(slashPath);
  }
  return normalize(raw).replace(/\\/g, '/');
}

function resolvePolicyPath(raw: string): string {
  const slashPath = raw.replace(/\\/g, '/');
  if (slashPath.startsWith('/')) {
    return posix.normalize(slashPath);
  }
  return resolve(raw);
}

function getBlockedPaths(): string[] {
  const blocked = new Set(BLOCKED_ABSOLUTE_PATHS.map(normalizePosixPath));

  const homes = new Set([
    homedir(),
    process.env.HOME,
    process.env.USERPROFILE,
  ].filter((home): home is string => Boolean(home && home !== '/')));
  for (const home of homes) {
    for (const sub of BLOCKED_HOME_SUBPATHS) {
      blocked.add(normalizePosixPath(resolvePolicyPath(`${home}/${sub}`)));
    }
  }

  return [...blocked];
}

/**
 * Check if `target` equals or is a descendant of `root`.
 */
function isPathInsideOrEqual(root: string, target: string): boolean {
  const normalizedRoot = normalizePosixPath(root);
  const normalizedTarget = normalizePosixPath(target);
  if (normalizedTarget === normalizedRoot) return true;
  const prefix = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;
  return normalizedTarget.startsWith(prefix);
}

function containsBlockedCredentialSegment(target: string): string | null {
  const normalized = normalizePosixPath(target);
  for (const sub of BLOCKED_HOME_SUBPATHS) {
    const prefix = `/${sub.replace(/\\/g, '/')}`;
    if (normalized.endsWith(prefix) || normalized.includes(`${prefix}/`)) {
      return sub;
    }
  }
  return null;
}

/**
 * Resolve symlinks by walking from the existing ancestor downward.
 * If the full path does not exist, resolve the deepest existing ancestor
 * and append the remaining segments — mirrors OpenClaw's approach.
 */
function resolveCanonicalPath(targetPath: string): string {
  try {
    return realpathSync(targetPath);
  } catch {
    // Path does not exist yet — resolve the deepest existing ancestor.
    const segments = targetPath.split(sep);
    let resolved = segments[0] === '' ? '/' : segments[0];
    let unresolved = '';

    for (let i = 1; i < segments.length; i++) {
      const candidate = resolve(resolved, segments[i]);
      try {
        resolved = realpathSync(candidate);
      } catch {
        unresolved = segments.slice(i).join('/');
        break;
      }
    }

    return unresolved ? `${resolved}/${unresolved}` : resolved;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate that a path does not escape into blocked system/credential directories.
 *
 * The check runs in two passes:
 *  1. Lexical: normalize the path and check against blocked prefixes.
 *  2. Canonical: resolve symlinks (or deepest existing ancestor) and re-check.
 *
 * When `allowedRoots` are provided, the path must additionally be inside at
 * least one of them (after canonical resolution).
 */
export function validatePath(
  rawPath: string,
  options?: {
    allowedRoots?: string[];
    extraBlockedPaths?: string[];
  },
): PathValidationResult {
  if (!rawPath || !rawPath.trim()) {
    return { allowed: false, reason: 'Empty path' };
  }

  const target = normalizePosixPath(resolvePolicyPath(rawPath));
  const blockedCredentialSegment = containsBlockedCredentialSegment(target);
  if (blockedCredentialSegment) {
    return { allowed: false, reason: `Path targets blocked directory: ${blockedCredentialSegment}` };
  }

  // Reject root mount
  if (target === '/' || target === '\\') {
    return { allowed: false, reason: 'Cannot operate on filesystem root' };
  }

  // --- Pass 1: lexical check ---
  const blockedPaths = [
    ...getBlockedPaths(),
    ...(options?.extraBlockedPaths?.map(normalizePosixPath) ?? []),
  ];

  for (const blocked of blockedPaths) {
    if (isPathInsideOrEqual(blocked, target)) {
      return { allowed: false, reason: `Path targets blocked directory: ${blocked}` };
    }
    // Also block if the target *covers* a blocked path (e.g. mounting "/" covers "/etc")
    if (isPathInsideOrEqual(target, blocked) && target !== blocked) {
      // Only block covering for very sensitive roots
      if (target === '/' || target === '/private') {
        return { allowed: false, reason: `Path covers blocked directory: ${blocked}` };
      }
    }
  }

  // --- Pass 2: canonical (symlink-resolved) check ---
  const canonical = resolveCanonicalPath(target);
  const canonicalNormalized = normalizePosixPath(canonical);

  if (canonicalNormalized !== target) {
    for (const blocked of blockedPaths) {
      if (isPathInsideOrEqual(blocked, canonicalNormalized)) {
        return {
          allowed: false,
          reason: `Path resolves (via symlink) to blocked directory: ${blocked}`,
        };
      }
    }
  }

  // --- Pass 3: allowed-roots enforcement ---
  if (options?.allowedRoots && options.allowedRoots.length > 0) {
    // Resolve roots the same way as the target so symlink prefixes (e.g. /home on macOS) match.
    const normalizedRoots = options.allowedRoots.map((r) =>
      normalizePosixPath(resolveCanonicalPath(resolvePolicyPath(r))),
    );
    const insideAllowedRoot = normalizedRoots.some((root) =>
      isPathInsideOrEqual(root, canonicalNormalized),
    );
    if (!insideAllowedRoot) {
      return {
        allowed: false,
        reason: `Path is outside allowed roots: ${normalizedRoots.join(', ')}`,
      };
    }
  }

  return { allowed: true, canonicalPath: canonicalNormalized };
}

/**
 * Validate a path specifically for file write/edit operations.
 * Adds protection for config files and profile system files.
 */
export function validateWritePath(
  rawPath: string,
  workspaceRoot: string,
  options?: { allowedRoots?: string[]; extraBlockedPaths?: string[] },
): PathValidationResult {
  // Resolve relative paths under workspace
  const resolvedPath = isAbsolute(rawPath) || rawPath.replace(/\\/g, '/').startsWith('/')
    ? rawPath
    : resolve(workspaceRoot, rawPath);

  // Config file protection
  const configProtectedPatterns = [
    /\/\.xopc\/xopc\.json$/,
    /\/\.env$/,
    /\/\.env\.local$/,
    /\/\.env\.production$/,
  ];

  const normalized = normalizePosixPath(resolvedPath);
  for (const pattern of configProtectedPatterns) {
    if (pattern.test(normalized)) {
      return { allowed: false, reason: `Cannot write to protected config file: ${normalized}` };
    }
  }

  return validatePath(resolvedPath, options);
}

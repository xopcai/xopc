import { existsSync, realpathSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';

import { resolveUserPath } from '../agent/agent-scope.js';
import { normalizeWorkspaceDir } from '../config/workspace-path.js';
import { resolveStateDir } from '../config/paths-state.js';
import type { Project } from './types.js';

export type WorkspaceProjectMatchReason = 'exact' | 'contained' | 'auto_created';

export type WorkspaceProjectMatch = {
  project: Project;
  reason: WorkspaceProjectMatchReason;
  created: boolean;
};

export class ProjectWorkspaceConflictError extends Error {
  constructor(readonly project: Project, message = `Workspace is already bound to project: ${project.name}`) {
    super(message);
    this.name = 'ProjectWorkspaceConflictError';
  }
}

const PROJECT_ROOT_MARKERS = [
  '.git',
  'pnpm-workspace.yaml',
  'package.json',
  'go.mod',
  'pyproject.toml',
  'Cargo.toml',
  'deno.json',
  'deno.jsonc',
  'bun.lockb',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'composer.json',
  'Gemfile',
] as const;

export function canonicalWorkspacePath(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const resolved = resolveUserPath(trimmed);
  const normalized = normalizeWorkspaceDir(resolved);
  if (!normalized) return null;
  try {
    const stat = statSync(normalized);
    if (!stat.isDirectory()) return normalized;
    return realpathSync.native(normalized);
  } catch {
    return normalized;
  }
}

function directoryForWorkspaceProbe(pathValue: string): string {
  try {
    return statSync(pathValue).isDirectory() ? pathValue : dirname(pathValue);
  } catch {
    return pathValue;
  }
}

function findGitRoot(startDir: string): string | null {
  try {
    const output = execFileSync('git', ['-C', startDir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    }).trim();
    return canonicalWorkspacePath(output);
  } catch {
    return null;
  }
}

function findMarkerRoot(startDir: string): string | null {
  let current = startDir;
  while (true) {
    if (PROJECT_ROOT_MARKERS.some((marker) => existsSync(join(current, marker)))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function resolveWorkspaceProjectRoot(raw: string | null | undefined): string | null {
  const canonical = canonicalWorkspacePath(raw);
  if (!canonical) return null;
  const startDir = directoryForWorkspaceProbe(canonical);
  const gitRoot = findGitRoot(startDir);
  if (gitRoot) return gitRoot;
  const markerRoot = findMarkerRoot(startDir);
  return canonicalWorkspacePath(markerRoot) ?? canonical;
}

function normalizeComparablePath(pathValue: string): string {
  const resolved = resolve(pathValue);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function isPathSameOrInsideWorkspace(workspaceRoot: string, candidatePath: string): boolean {
  const root = normalizeComparablePath(workspaceRoot);
  const candidate = normalizeComparablePath(candidatePath);
  const rel = relative(root, candidate);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

export function inferProjectNameFromWorkspaceRoot(workspaceRoot: string | null | undefined): string | null {
  const canonical = canonicalWorkspacePath(workspaceRoot);
  if (!canonical) return null;
  const name = basename(canonical).trim();
  return name || null;
}

export function isSafeAutoCreateWorkspaceRoot(workspaceRoot: string | null | undefined): boolean {
  const canonical = canonicalWorkspacePath(workspaceRoot);
  if (!canonical) return false;
  const normalized = normalizeComparablePath(canonical);
  const forbidden = [homedir(), tmpdir(), resolveStateDir()]
    .map((p) => canonicalWorkspacePath(p))
    .filter((p): p is string => Boolean(p))
    .map(normalizeComparablePath);
  if (forbidden.includes(normalized)) return false;
  // `normalizeWorkspaceDir` already rejects filesystem roots; keep this function
  // conservative for callers that pass unusual platform-specific roots.
  if (normalizeComparablePath(canonical) === normalizeComparablePath(parse(canonical).root)) return false;
  if (!basename(canonical).trim()) return false;
  try {
    return statSync(canonical).isDirectory();
  } catch {
    return false;
  }
}

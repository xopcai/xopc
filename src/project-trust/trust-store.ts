import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';

import lockfile from 'proper-lockfile';

import { resolveStateDir } from '../config/paths.js';

export type ProjectTrustDecision = boolean | null;

export interface ProjectTrustStoreEntry {
  path: string;
  decision: boolean;
}

export interface ProjectTrustUpdate {
  path: string;
  decision: ProjectTrustDecision;
}

export interface ProjectTrustOption {
  label: string;
  trusted: boolean;
  updates: ProjectTrustUpdate[];
  savedPath?: string;
}

type TrustFile = Record<string, boolean | null | undefined>;

const TRUST_REQUIRING_XOPC_PROJECT_RESOURCES = [
  'settings.json',
  'extensions',
  'skills',
  'prompts',
  'themes',
  'SYSTEM.md',
  'APPEND_SYSTEM.md',
  'workspace.json',
] as const;

function canonicalizePath(path: string): string {
  const resolved = resolvePath(path);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function normalizeCwd(cwd: string): string {
  return canonicalizePath(cwd);
}

function readTrustFile(path: string): TrustFile {
  if (!existsSync(path)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read project trust store ${path}: ${errorMessage}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid project trust store ${path}: expected an object`);
  }

  const data: TrustFile = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== true && value !== false && value !== null) {
      throw new Error(`Invalid project trust store ${path}: value for ${JSON.stringify(key)} must be true, false, or null`);
    }
    data[normalizeCwd(key)] = value;
  }
  return data;
}

function writeTrustFile(path: string, data: TrustFile): void {
  const sorted: TrustFile = {};
  for (const key of Object.keys(data).sort()) {
    const value = data[key];
    if (value === true || value === false || value === null) {
      sorted[key] = value;
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

function acquireTrustLockSync(path: string): () => void {
  const trustDir = dirname(path);
  mkdirSync(trustDir, { recursive: true });
  const maxAttempts = 10;
  const delayMs = 20;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return lockfile.lockSync(trustDir, { realpath: false, lockfilePath: `${path}.lock` });
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : undefined;
      if (code !== 'ELOCKED' || attempt === maxAttempts) {
        throw err;
      }
      const startedAt = Date.now();
      while (Date.now() - startedAt < delayMs) {
        // Synchronous callers need a tiny bounded wait while another TUI updates trust.json.
      }
    }
  }

  throw new Error('Failed to acquire project trust store lock');
}

function withTrustFileLock<T>(path: string, fn: () => T): T {
  const release = acquireTrustLockSync(path);
  try {
    return fn();
  } finally {
    release();
  }
}

function findNearestTrustEntry(data: TrustFile, cwd: string): ProjectTrustStoreEntry | null {
  let currentDir = normalizeCwd(cwd);
  while (true) {
    const value = data[currentDir];
    if (value === true || value === false) {
      return { path: currentDir, decision: value };
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

export function resolveProjectTrustStorePath(): string {
  return join(resolveStateDir(), 'trust.json');
}

export function getProjectTrustParentPath(cwd: string): string | undefined {
  const trustPath = normalizeCwd(cwd);
  const parentDir = dirname(trustPath);
  return parentDir === trustPath ? undefined : parentDir;
}

export function getProjectTrustOptions(
  cwd: string,
  options: { includeSessionOnly?: boolean } = {},
): ProjectTrustOption[] {
  const trustPath = normalizeCwd(cwd);
  const trustOptions: ProjectTrustOption[] = [
    { label: 'Trust', trusted: true, updates: [{ path: trustPath, decision: true }], savedPath: trustPath },
  ];
  const parentPath = getProjectTrustParentPath(cwd);
  if (parentPath) {
    trustOptions.push({
      label: `Trust parent folder (${parentPath})`,
      trusted: true,
      updates: [
        { path: parentPath, decision: true },
        { path: trustPath, decision: null },
      ],
      savedPath: parentPath,
    });
  }
  if (options.includeSessionOnly) {
    trustOptions.push({ label: 'Trust (this session only)', trusted: true, updates: [] });
  }
  trustOptions.push({
    label: 'Do not trust',
    trusted: false,
    updates: [{ path: trustPath, decision: false }],
    savedPath: trustPath,
  });
  if (options.includeSessionOnly) {
    trustOptions.push({ label: 'Do not trust (this session only)', trusted: false, updates: [] });
  }
  return trustOptions;
}

export function hasTrustRequiringProjectResources(cwd: string): boolean {
  const homeDir = canonicalizePath(process.env.HOME || homedir());
  const userAgentsSkillsDir = join(homeDir, '.agents', 'skills');
  let currentDir = canonicalizePath(cwd);

  const xopcProjectDir = join(currentDir, '.xopc');
  if (TRUST_REQUIRING_XOPC_PROJECT_RESOURCES.some((entry) => existsSync(join(xopcProjectDir, entry)))) {
    return true;
  }

  while (true) {
    const agentsSkillsDir = join(currentDir, '.agents', 'skills');
    if (agentsSkillsDir !== userAgentsSkillsDir && existsSync(agentsSkillsDir)) {
      return true;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) return false;
    currentDir = parentDir;
  }
}

export class ProjectTrustStore {
  constructor(private readonly trustPath: string = resolveProjectTrustStorePath()) {}

  getPath(): string {
    return this.trustPath;
  }

  get(cwd: string): ProjectTrustDecision {
    return this.getEntry(cwd)?.decision ?? null;
  }

  getEntry(cwd: string): ProjectTrustStoreEntry | null {
    return withTrustFileLock(this.trustPath, () => findNearestTrustEntry(readTrustFile(this.trustPath), cwd));
  }

  set(cwd: string, decision: ProjectTrustDecision): void {
    this.setMany([{ path: cwd, decision }]);
  }

  setMany(decisions: ProjectTrustUpdate[]): void {
    withTrustFileLock(this.trustPath, () => {
      const data = readTrustFile(this.trustPath);
      for (const { path, decision } of decisions) {
        const key = normalizeCwd(path);
        if (decision === null) {
          delete data[key];
        } else {
          data[key] = decision;
        }
      }
      writeTrustFile(this.trustPath, data);
    });
  }
}

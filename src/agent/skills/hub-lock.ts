/**
 * Skills hub lock (~/.xopc/skills-lock.json): records install source + tree hash per managed skill id.
 */

import { existsSync, readFileSync } from 'node:fs';

import { resolveSkillsLockPath } from '../../config/paths.js';
import { writeTextAtomicSync } from '../../infra/write-file-atomic.js';

export type SkillHubKind = 'git' | 'archive';

export interface SkillHubLockEntry {
  kind: SkillHubKind;
  /** Clone URL, tarball URL, or file path (as given at install time). */
  source: string;
  /** Git branch / tag / ref (optional). */
  ref?: string;
  /** Path inside the cloned repo (POSIX, no leading slash). */
  subpath?: string;
  /** Deterministic tree hash from {@link computeSkillTreeHash}. */
  contentHash: string;
  installedAt: string;
  updatedAt: string;
}

export interface SkillsLockFile {
  version: 1;
  entries: Record<string, SkillHubLockEntry>;
}

function emptyLock(): SkillsLockFile {
  return { version: 1, entries: {} };
}

export function loadSkillsLock(lockPath = resolveSkillsLockPath()): SkillsLockFile {
  const p = lockPath;
  if (!existsSync(p)) return emptyLock();
  try {
    const raw = readFileSync(p, 'utf-8');
    const j = JSON.parse(raw) as Partial<SkillsLockFile>;
    if (j.version !== 1 || !j.entries || typeof j.entries !== 'object') {
      return emptyLock();
    }
    return { version: 1, entries: { ...j.entries } };
  } catch {
    return emptyLock();
  }
}

export function saveSkillsLock(lock: SkillsLockFile, lockPath = resolveSkillsLockPath()): void {
  const p = lockPath;
  writeTextAtomicSync(p, `${JSON.stringify(lock, null, 2)}\n`);
}

/** Record or replace hub metadata for a managed skill directory id (folder name under ~/.xopc/skills). */
export function recordSkillsHubInstall(
  skillId: string,
  meta: Pick<SkillHubLockEntry, 'kind' | 'source' | 'ref' | 'subpath'>,
  contentHash: string,
  lockPath?: string,
): void {
  const lock = loadSkillsLock(lockPath);
  const now = new Date().toISOString();
  const prev = lock.entries[skillId];
  lock.entries[skillId] = {
    kind: meta.kind,
    source: meta.source,
    ref: meta.ref,
    subpath: meta.subpath,
    contentHash,
    installedAt: prev?.installedAt ?? now,
    updatedAt: now,
  };
  saveSkillsLock(lock, lockPath);
}

export function removeSkillsLockEntry(skillId: string, lockPath?: string): void {
  const lock = loadSkillsLock(lockPath);
  if (!lock.entries[skillId]) return;
  delete lock.entries[skillId];
  saveSkillsLock(lock, lockPath);
}

export function getSkillsLockEntry(skillId: string, lockPath?: string): SkillHubLockEntry | undefined {
  return loadSkillsLock(lockPath).entries[skillId];
}

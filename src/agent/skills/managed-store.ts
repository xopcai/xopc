/**
 * Managed skills live under ~/.xopc/skills (see resolveSkillsDir).
 * Install/update/delete via zip or folder operations; used by gateway API.
 */

import AdmZip from 'adm-zip';
import {
  existsSync,
  mkdirSync,
  renameSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { resolveSkillsDir } from '../../config/paths.js';
import { parseFrontmatter } from '../../markdown/frontmatter.js';
import { loadSkillsLock, type SkillHubLockEntry } from './hub-lock.js';

export const MAX_SKILL_ZIP_BYTES = 15 * 1024 * 1024;

const SKILL_ID_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,62})$/;
const TEMP_PREFIX = '.tmp-';
const TRASH_PREFIX = '.trash-';

export function isValidSkillId(id: string): boolean {
  return SKILL_ID_RE.test(id);
}

export function isManagedSkillTransientDirName(name: string): boolean {
  return name.startsWith(TEMP_PREFIX) || name.startsWith(TRASH_PREFIX);
}

/** True when `baseDir` is the global managed skills root or a direct child folder. */
export function isUnderManagedSkillsDir(baseDir: string): boolean {
  const b = resolve(baseDir);
  const r = resolve(resolveSkillsDir());
  return b === r || b.startsWith(r + sep);
}

function isSafeZipPath(name: string): boolean {
  if (!name) return false;
  const normalized = name.replace(/\\/g, '/');
  if (normalized.includes('..')) return false;
  if (normalized.startsWith('/') || /^\w:/.test(normalized)) return false;
  for (const p of normalized.split('/')) {
    if (p === '..') return false;
  }
  return true;
}

/** macOS/Windows noise; not part of the skill tree. */
export function isIgnorableZipEntry(name: string): boolean {
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('__MACOSX/')) return true;
  const segments = n.split('/').filter(Boolean);
  for (const s of segments) {
    if (s === '.DS_Store' || s === 'Thumbs.db' || s === 'desktop.ini') return true;
    if (s.startsWith('._')) return true;
  }
  return false;
}

export interface ManagedSkillListItem {
  id: string;
  name: string;
  description: string;
  path: string;
  /** Set when this folder was installed via `skills hub pull` / lock file. */
  hub?: SkillHubLockEntry;
}

function readSkillMdMeta(skillMdPath: string): { name: string; description: string } {
  try {
    const raw = readFileSync(skillMdPath, 'utf-8');
    const { frontmatter } = parseFrontmatter(raw);
    return {
      name: (frontmatter.name as string) || '',
      description: (frontmatter.description as string)?.trim() || '',
    };
  } catch {
    return { name: '', description: '' };
  }
}

export function listManagedSkillDirs(): ManagedSkillListItem[] {
  const root = resolveSkillsDir();
  mkdirSync(root, { recursive: true });
  const lock = loadSkillsLock();
  let dirNames: string[];
  try {
    dirNames = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return [];
  }
  const out: ManagedSkillListItem[] = [];
  for (const id of dirNames) {
    if (!isValidSkillId(id)) continue;
    const skillMd = join(root, id, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    const meta = readSkillMdMeta(skillMd);
    const hub = lock.entries[id];
    out.push({
      id,
      name: meta.name || id,
      description: meta.description || '',
      path: join(root, id),
      ...(hub ? { hub } : {}),
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export function deleteManagedSkill(skillId: string, rootDir = resolveSkillsDir()): void {
  if (!isValidSkillId(skillId)) {
    throw new Error('Invalid skill id');
  }
  const root = resolve(rootDir);
  const dir = resolve(join(root, skillId));
  const rootResolved = resolve(root);
  if (!dir.startsWith(rootResolved + sep) && dir !== rootResolved) {
    throw new Error('Invalid path');
  }
  if (!existsSync(join(dir, 'SKILL.md'))) {
    throw new Error('Skill not found');
  }
  const trashDir = createTransientManagedDir(root, TRASH_PREFIX, skillId);
  renameSync(dir, trashDir);
  rmSync(trashDir, { recursive: true, force: true });
}

function createTransientManagedDir(root: string, prefix: string, skillId: string): string {
  for (let i = 0; i < 100; i += 1) {
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${i}`;
    const dir = join(root, `${prefix}${skillId}-${suffix}`);
    if (!existsSync(dir)) return dir;
  }
  throw new Error('Could not allocate temporary skill directory');
}

export function getManagedSkillDir(skillId: string): string {
  if (!isValidSkillId(skillId)) {
    throw new Error('Invalid skill id');
  }
  return join(resolveSkillsDir(), skillId);
}

export function assertManagedSkillDestination(
  skillId: string,
  rootDir = resolveSkillsDir(),
): { root: string; destDir: string } {
  if (!isValidSkillId(skillId)) {
    throw new Error(`Invalid skill id "${skillId}" (letters, digits, ._-; max 63 chars after first)`);
  }
  const root = resolve(rootDir);
  mkdirSync(root, { recursive: true });
  const destDir = join(root, skillId);
  const destResolved = resolve(destDir);
  const rootResolved = resolve(root);
  if (!destResolved.startsWith(rootResolved + sep) && destResolved !== rootResolved) {
    throw new Error('Invalid destination path');
  }
  return { root, destDir };
}

export function prepareManagedSkillTempDir(
  skillId: string,
  rootDir?: string,
): { root: string; destDir: string; tempDir: string } {
  const { root, destDir } = assertManagedSkillDestination(skillId, rootDir);
  const tempDir = createTransientManagedDir(root, TEMP_PREFIX, skillId);
  mkdirSync(tempDir, { recursive: true });
  return { root, destDir, tempDir };
}

export function promoteManagedSkillTempDir(params: {
  skillId: string;
  tempDir: string;
  overwrite?: boolean;
  rootDir?: string;
}): { skillId: string; path: string } {
  const { root, destDir } = assertManagedSkillDestination(params.skillId, params.rootDir);
  const tempResolved = resolve(params.tempDir);
  const rootResolved = resolve(root);
  if (!tempResolved.startsWith(rootResolved + sep)) {
    throw new Error('Invalid temporary skill directory');
  }
  if (!existsSync(join(params.tempDir, 'SKILL.md'))) {
    throw new Error('Installed tree is missing SKILL.md');
  }

  if (existsSync(destDir)) {
    if (!params.overwrite) {
      throw new Error(`Skill "${params.skillId}" already exists. Pass overwrite to replace.`);
    }
    const trashDir = createTransientManagedDir(root, TRASH_PREFIX, params.skillId);
    renameSync(destDir, trashDir);
    try {
      renameSync(params.tempDir, destDir);
    } catch (err) {
      renameSync(trashDir, destDir);
      throw err;
    }
    rmSync(trashDir, { recursive: true, force: true });
  } else {
    renameSync(params.tempDir, destDir);
  }

  return { skillId: params.skillId, path: destDir };
}

function inferStripPrefix(primary: string): string {
  const parts = primary.split('/').filter(Boolean);
  if (parts.length === 1 && parts[0].toLowerCase() === 'skill.md') {
    return '';
  }
  return primary.slice(0, -'SKILL.md'.length);
}

/**
 * Install or replace a skill from a zip buffer. Layout: either `SKILL.md` at archive root
 * or a single top-level folder containing `SKILL.md` (optionally nested one level).
 */
export function installSkillFromZip(
  buffer: Buffer,
  options: { skillId?: string; overwrite?: boolean; rootDir?: string },
): { skillId: string; path: string } {
  if (buffer.length > MAX_SKILL_ZIP_BYTES) {
    throw new Error(`Zip exceeds maximum size (${MAX_SKILL_ZIP_BYTES} bytes)`);
  }

  const zip = new AdmZip(buffer);
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory && e.entryName && !isIgnorableZipEntry(e.entryName));

  const safeEntries = entries.filter((e) => isSafeZipPath(e.entryName));
  if (safeEntries.length === 0) {
    throw new Error('Zip is empty or invalid');
  }

  const names = safeEntries.map((e) => e.entryName.replace(/\\/g, '/'));
  const skillMdPaths = names.filter((n) => /(^|\/)SKILL\.md$/i.test(n));
  if (skillMdPaths.length === 0) {
    throw new Error('Zip must contain at least one SKILL.md');
  }

  const shallow = skillMdPaths.filter((p) => p.split('/').filter(Boolean).length <= 2);
  if (shallow.length === 0) {
    throw new Error(
      'SKILL.md is nested too deeply; use a zip with SKILL.md at archive root or one folder (e.g. my-skill/SKILL.md)',
    );
  }

  shallow.sort((a, b) => a.length - b.length);
  const stripPrefix = inferStripPrefix(shallow[0]);

  if (stripPrefix) {
    const prefixNorm = stripPrefix.replace(/\\/g, '/');
    const outside = names.filter((n) => !n.startsWith(prefixNorm) && !isIgnorableZipEntry(n));
    if (outside.length > 0) {
      throw new Error(
        `Invalid zip: expected all skill files under "${prefixNorm.replace(/\/$/, '')}/", but found "${outside[0]}". ` +
          'Put SKILL.md and assets in one folder, or zip that folder only.',
      );
    }
  }

  let targetId = options.skillId?.trim();
  if (!targetId) {
    if (stripPrefix) {
      const first = stripPrefix.replace(/\/$/, '').split('/')[0];
      targetId = first || '';
    }
    if (!targetId) {
      const skillName = shallow.find((n) => /(^|\/)SKILL\.md$/i.test(n)) || '';
      const entry = zip.getEntry(skillName);
      if (!entry) throw new Error('SKILL.md missing');
      const raw = entry.getData().toString('utf-8');
      const { frontmatter } = parseFrontmatter(raw);
      targetId = String(frontmatter.name || '').trim();
    }
  }

  if (!targetId || !isValidSkillId(targetId)) {
    throw new Error(
      'Could not determine skill id: use a folder named with the skill id, pass skillId, or set name: in SKILL.md (letters, digits, ._-)',
    );
  }

  const { destDir, tempDir } = prepareManagedSkillTempDir(targetId, options.rootDir);
  const tempResolved = resolve(tempDir);
  try {
    if (existsSync(destDir) && !options.overwrite) {
      throw new Error(`Skill "${targetId}" already exists. Pass overwrite to replace.`);
    }

    for (const e of safeEntries) {
      const norm = e.entryName.replace(/\\/g, '/');
      let rel: string;
      if (stripPrefix) {
        const prefixNorm = stripPrefix.replace(/\\/g, '/');
        if (!norm.startsWith(prefixNorm)) continue;
        rel = norm.slice(prefixNorm.length).replace(/^\//, '');
      } else {
        rel = norm;
      }
      if (!rel || rel.includes('..')) continue;

      const targetPath = join(tempDir, rel);
      const resolvedTarget = resolve(targetPath);
      if (!resolvedTarget.startsWith(tempResolved + sep) && resolvedTarget !== tempResolved) {
        continue;
      }
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, e.getData());
    }

    if (!existsSync(join(tempDir, 'SKILL.md'))) {
      throw new Error('Extracted content is missing SKILL.md');
    }

    return promoteManagedSkillTempDir({
      skillId: targetId,
      tempDir,
      overwrite: options.overwrite,
      rootDir: options.rootDir,
    });
  } catch (err) {
    rmSync(tempDir, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Managed skills live under ~/.xopcbot/skills (see resolveSkillsDir).
 * Install/update/delete via zip or folder operations; used by gateway API.
 */

import AdmZip from 'adm-zip';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { resolveSkillsDir } from '../../config/paths.js';
import { parseFrontmatter } from '../../utils/frontmatter.js';

export const MAX_SKILL_ZIP_BYTES = 15 * 1024 * 1024;

const SKILL_ID_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,62})$/;

export function isValidSkillId(id: string): boolean {
  return SKILL_ID_RE.test(id);
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
    out.push({
      id,
      name: meta.name || id,
      description: meta.description || '',
      path: join(root, id),
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export function deleteManagedSkill(skillId: string): void {
  if (!isValidSkillId(skillId)) {
    throw new Error('Invalid skill id');
  }
  const root = resolveSkillsDir();
  const dir = resolve(join(root, skillId));
  const rootResolved = resolve(root);
  if (!dir.startsWith(rootResolved + sep) && dir !== rootResolved) {
    throw new Error('Invalid path');
  }
  if (!existsSync(join(dir, 'SKILL.md'))) {
    throw new Error('Skill not found');
  }
  rmSync(dir, { recursive: true, force: true });
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
  options: { skillId?: string; overwrite?: boolean },
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

  const root = resolveSkillsDir();
  mkdirSync(root, { recursive: true });

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

  const destDir = join(root, targetId);
  const destResolved = resolve(destDir);
  const rootResolved = resolve(root);
  if (!destResolved.startsWith(rootResolved + sep) && destResolved !== rootResolved) {
    throw new Error('Invalid destination');
  }

  if (existsSync(destDir)) {
    if (!options.overwrite) {
      throw new Error(`Skill "${targetId}" already exists. Pass overwrite to replace.`);
    }
    rmSync(destDir, { recursive: true, force: true });
  }
  mkdirSync(destDir, { recursive: true });

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

    const targetPath = join(destDir, rel);
    const resolvedTarget = resolve(targetPath);
    if (!resolvedTarget.startsWith(destResolved + sep) && resolvedTarget !== destResolved) {
      continue;
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, e.getData());
  }

  if (!existsSync(join(destDir, 'SKILL.md'))) {
    rmSync(destDir, { recursive: true, force: true });
    throw new Error('Extracted content is missing SKILL.md');
  }

  return { skillId: targetId, path: destDir };
}

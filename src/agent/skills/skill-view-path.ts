/**
 * Resolve safe paths for skill_view: only SKILL.md (default) or files under allowlisted subdirs.
 */

import { existsSync, realpathSync } from 'fs';
import { resolve, sep } from 'path';

import type { Skill } from './types.js';

const ALLOWED_TOP = new Set(['references', 'templates', 'scripts', 'assets']);

export type ResolveSkillFileResult =
  | { ok: true; absolutePath: string }
  | { ok: false; error: string };

function isSkillMdSegment(p: string): boolean {
  const s = p.trim();
  return s === 'SKILL.md' || s.toLowerCase() === 'skill.md';
}

function isInsideDir(dirReal: string, fileReal: string): boolean {
  const prefix = dirReal.endsWith(sep) ? dirReal : dirReal + sep;
  return fileReal === dirReal || fileReal.startsWith(prefix);
}

/**
 * Resolve a readable file path for {@link skill}. Empty or SKILL.md → main SKILL.md file.
 * Other paths must live under references/, templates/, scripts/, or assets/.
 */
export function resolveSkillReadablePath(
  skill: Skill,
  subPath: string | undefined,
): ResolveSkillFileResult {
  const base = skill.baseDir;
  const trimmed = subPath?.trim() ?? '';

  let target: string;
  if (!trimmed || trimmed === '.' || isSkillMdSegment(trimmed)) {
    target = skill.filePath;
  } else {
    const norm = trimmed.replace(/\\/g, '/');
    if (norm.includes('..')) {
      return { ok: false, error: 'Invalid path: path traversal is not allowed.' };
    }
    if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) {
      return {
        ok: false,
        error: 'Invalid path: use a path relative to the skill directory.',
      };
    }
    const first = norm.split('/').filter(Boolean)[0] ?? '';
    if (!ALLOWED_TOP.has(first)) {
      return {
        ok: false,
        error: `Invalid path: must be under references/, templates/, scripts/, or assets/ (or omit path for SKILL.md).`,
      };
    }
    target = resolve(base, norm);
  }

  try {
    const baseReal = realpathSync(base);
    if (!existsSync(target)) {
      return { ok: false, error: `File not found: ${trimmed || 'SKILL.md'}` };
    }
    const targetReal = realpathSync(target);
    if (!isInsideDir(baseReal, targetReal)) {
      return { ok: false, error: 'Resolved path escapes the skill directory.' };
    }
    return { ok: true, absolutePath: targetReal };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

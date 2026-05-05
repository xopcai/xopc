/**
 * Resolve safe paths for skill_view: only SKILL.md (default) or files under allowlisted subdirs.
 * Also provides localized SKILL.md resolution for multi-language display.
 */

import { existsSync, readFileSync, realpathSync } from 'fs';
import { join, resolve, sep } from 'path';

import { parseFrontmatter } from '../../markdown/frontmatter.js';
import { parseRequiredEnvVarNames } from './required-env-vars.js';
import { parseSkillMetadata } from './parse-skill-metadata.js';
import { parseSkillToolConditions } from './skill-tool-gating.js';
import type { Skill, SkillMarkdownPreviewPayload } from './types.js';

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

/**
 * Resolve a localized SKILL.md for display (e.g. SKILL-zh.md, SKILL-en.md).
 * Falls back to the base SKILL.md content if no localized file exists.
 *
 * This is the **display** path — execution always reads the base SKILL.md.
 */
export function resolveLocalizedSkillMarkdown(
  skill: Skill,
  lang?: string,
): SkillMarkdownPreviewPayload | null {
  if (!lang) {
    return null; // caller should fall back to skill.content
  }

  // Normalize: prefer two-letter code
  const normalizedLang = lang.split(/[-_]/)[0]?.toLowerCase();
  if (!normalizedLang || normalizedLang === 'en') {
    return null; // 'en' is the base SKILL.md
  }

  const localizedPath = join(skill.baseDir, `SKILL-${normalizedLang}.md`);
  if (!existsSync(localizedPath)) {
    return null;
  }

  try {
    const rawContent = readFileSync(localizedPath, 'utf-8');
    const { frontmatter, content } = parseFrontmatter(rawContent);
    const fm = frontmatter as Record<string, unknown>;

    const name = (typeof fm.name === 'string' && fm.name.trim()) || skill.name;
    const descFromFm = typeof fm.description === 'string' ? fm.description.trim() : '';
    const description = descFromFm || skill.description;
    const metadata = parseSkillMetadata(fm);
    if (!metadata.name.trim()) metadata.name = name;
    if (!metadata.description.trim()) metadata.description = description;

    const toolConditions = parseSkillToolConditions(fm);
    const requiredEnvVarNames = parseRequiredEnvVarNames(fm);

    return {
      name,
      description,
      bodyMarkdown: content.trim(),
      disableModelInvocation: skill.disableModelInvocation,
      metadata,
      toolConditions,
      requiredEnvVarNames: requiredEnvVarNames.length > 0 ? requiredEnvVarNames : undefined,
    };
  } catch {
    return null; // parse error → fall back
  }
}

/**
 * Lightweight localized name/description lookup (frontmatter only) for list views.
 * Reuses the same SKILL-{lang}.md resolution as {@link resolveLocalizedSkillMarkdown}.
 */
export function resolveLocalizedSkillMeta(
  skill: Skill,
  lang: string,
): { name: string; description: string } | null {
  const normalizedLang = lang.split(/[-_]/)[0]?.toLowerCase();
  if (!normalizedLang || normalizedLang === 'en') return null;

  const localizedPath = join(skill.baseDir, `SKILL-${normalizedLang}.md`);
  if (!existsSync(localizedPath)) return null;

  try {
    const rawContent = readFileSync(localizedPath, 'utf-8');
    const { frontmatter } = parseFrontmatter(rawContent);
    const fm = frontmatter as Record<string, unknown>;
    const name = typeof fm.name === 'string' && fm.name.trim() ? fm.name.trim() : undefined;
    const description =
      typeof fm.description === 'string' && fm.description.trim() ? fm.description.trim() : undefined;
    if (!name && !description) return null;
    return {
      name: name ?? skill.name,
      description: description ?? skill.description,
    };
  } catch {
    return null;
  }
}

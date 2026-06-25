/**
 * Shared logic for the skill_manage agent tool (create / edit / patch / delete / write_file / remove_file).
 */

import { existsSync, realpathSync } from 'fs';
import { join, resolve, sep } from 'path';
import { mkdir, writeFile } from 'fs/promises';

import { parseFrontmatter } from '../../markdown/frontmatter.js';
import { resolveSkillsDir } from '../../config/paths.js';
import type { Skill } from './types.js';
import type { SkillsConfig } from './types.js';
import { scanSkillDirectory, formatScanSummary } from './scanner.js';
import { resolveWorkspaceSkillsDir } from './workspace-skills-dir.js';

export const SKILL_MANAGE_ALLOWED_SUBDIRS = new Set(['references', 'templates', 'scripts', 'assets']);

export const SKILL_MANAGE_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
export const DEFAULT_MAX_SKILL_MD_CHARS = 100_000;
export const DEFAULT_MAX_SUPPORT_FILE_BYTES = 1_048_576;

export type AgentWritePolicy = 'global' | 'workspace' | 'both';

export function effectiveAgentWritePolicy(cfg?: SkillsConfig): AgentWritePolicy {
  const p = cfg?.agentWritePolicy;
  if (p === 'workspace' || p === 'both') return p;
  return 'global';
}

export function maxSkillMdChars(_cfg?: SkillsConfig): number {
  return DEFAULT_MAX_SKILL_MD_CHARS;
}

export function maxSupportFileBytes(cfg?: SkillsConfig): number {
  const n = cfg?.limits?.maxSkillFileBytes;
  if (typeof n === 'number' && n > 0) return n;
  return DEFAULT_MAX_SUPPORT_FILE_BYTES;
}

export function validateSkillNameSegment(name: string, label: string): string | null {
  if (!name?.trim()) return `${label} is required.`;
  if (name.length > 64) return `${label} must be at most 64 characters.`;
  if (!SKILL_MANAGE_NAME_RE.test(name)) {
    return `${label} must match ${SKILL_MANAGE_NAME_RE}: lowercase letters, digits, ., _, -`;
  }
  return null;
}

export function validateSkillMdContent(
  content: string,
  expectedName: string,
  maxChars: number,
): { ok: true } | { ok: false; error: string } {
  if (!content.trim()) return { ok: false, error: 'Content cannot be empty.' };
  if (content.length > maxChars) {
    return { ok: false, error: `SKILL.md exceeds limit (${maxChars} characters).` };
  }
  if (!content.startsWith('---')) {
    return { ok: false, error: 'SKILL.md must start with YAML frontmatter (---).' };
  }
  const close = /\r?\n---\s*\r?\n/.exec(content.slice(3));
  if (!close) {
    return { ok: false, error: 'Frontmatter must be closed with a line --- before the body.' };
  }
  const { frontmatter, content: body } = parseFrontmatter<Record<string, unknown>>(content);
  const name = frontmatter.name;
  const desc = frontmatter.description;
  if (typeof name !== 'string' || !name.trim()) {
    return { ok: false, error: 'Frontmatter must include a string name field.' };
  }
  if (typeof desc !== 'string' || !desc.trim()) {
    return { ok: false, error: 'Frontmatter must include a string description field.' };
  }
  if (name.trim() !== expectedName) {
    return {
      ok: false,
      error: `Frontmatter name "${name.trim()}" must match skill name "${expectedName}".`,
    };
  }
  if (!body?.trim()) {
    return { ok: false, error: 'SKILL.md must have a non-empty body after frontmatter.' };
  }
  return { ok: true };
}

function resolvedPathPrefix(dir: string): string {
  const r = resolve(dir);
  return r.endsWith(sep) ? r : r + sep;
}

/** Whether `filePath` is equal to `dir` or strictly inside it (resolved). */
export function isPathInsideDir(dir: string, filePath: string): boolean {
  try {
    const base = resolve(dir);
    const target = resolve(filePath);
    const baseReal = existsSync(base) ? realpathSync(base) : base;
    const targetReal = existsSync(target) ? realpathSync(target) : target;
    const prefix = resolvedPathPrefix(baseReal);
    return targetReal === baseReal || targetReal.startsWith(prefix);
  } catch {
    return false;
  }
}

export function resolveGlobalSkillsRoot(): string {
  return resolveSkillsDir();
}

export function resolveWorkspaceSkillsRoot(workspace: string): string {
  return resolveWorkspaceSkillsDir(workspace);
}

export function canWriteToPath(
  skillBaseDir: string,
  workspace: string,
  policy: AgentWritePolicy,
): boolean {
  try {
    const baseResolved = existsSync(skillBaseDir) ? realpathSync(skillBaseDir) : resolve(skillBaseDir);
    const globalRoot = resolveGlobalSkillsRoot();
    const wsRoot = resolveWorkspaceSkillsRoot(workspace);
    const underGlobal = isPathInsideDir(globalRoot, baseResolved);
    const underWs = isPathInsideDir(wsRoot, baseResolved);
    if (policy === 'global') return underGlobal;
    if (policy === 'workspace') return underWs;
    return underGlobal || underWs;
  } catch {
    return false;
  }
}

export function mutatableSkillOrNull(
  skill: Skill | undefined,
  workspace: string,
  policy: AgentWritePolicy,
): Skill | null {
  if (!skill) return null;
  if (skill.source === 'builtin' || skill.source === 'extra') return null;
  if (!canWriteToPath(skill.baseDir, workspace, policy)) return null;
  return skill;
}

export function validateSupportingRelativePath(filePath: string): string | null {
  if (!filePath?.trim()) return 'file_path is required.';
  const norm = filePath.replace(/\\/g, '/');
  if (norm.includes('..')) return "Path traversal ('..') is not allowed.";
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) {
    return 'file_path must be relative to the skill directory.';
  }
  const parts = norm.split('/').filter(Boolean);
  if (parts.length < 2) {
    return 'Provide a file path with a subdirectory, e.g. references/notes.md';
  }
  if (!SKILL_MANAGE_ALLOWED_SUBDIRS.has(parts[0]!)) {
    return `File must be under one of: ${[...SKILL_MANAGE_ALLOWED_SUBDIRS].join(', ')}.`;
  }
  return null;
}

export async function atomicWriteUtf8(filePath: string, content: string): Promise<void> {
  const dir = resolve(filePath, '..');
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}

/** Scan skill dir; returns error message if critical findings (caller rolls back). */
export async function scanSkillDirOrError(skillDir: string, skillName: string): Promise<string | null> {
  const summary = await scanSkillDirectory(skillDir);
  if (summary.critical > 0) {
    return `Security scan blocked this change:\n${formatScanSummary(summary, skillName)}`;
  }
  return null;
}

export function resolveCreateSkillDir(
  name: string,
  category: string | undefined,
  writeTarget: 'global' | 'workspace',
  workspace: string,
  policy: AgentWritePolicy,
): { ok: true; dir: string } | { ok: false; error: string } {
  if (writeTarget === 'global' && policy === 'workspace') {
    return { ok: false, error: 'Creating under global skills is not allowed (skills.agentWritePolicy).' };
  }
  if (writeTarget === 'workspace' && policy === 'global') {
    return { ok: false, error: 'Creating under workspace skills is not allowed (skills.agentWritePolicy).' };
  }
  const root =
    writeTarget === 'global' ? resolveGlobalSkillsRoot() : resolveWorkspaceSkillsRoot(workspace);
  const dir = category?.trim() ? join(root, category.trim(), name) : join(root, name);
  return { ok: true, dir };
}

export function ensureCategorySegment(category: string | undefined): string | null {
  if (category === undefined || category === null || category === '') return null;
  if (typeof category !== 'string') return 'category must be a string.';
  const c = category.trim();
  if (!c) return null;
  if (c.includes('/') || c.includes('\\')) return 'category must be a single path segment.';
  return validateSkillNameSegment(c, 'category');
}

import { normalizeToLF, restoreLineEndings, fuzzyFindText, normalizeForFuzzyMatch } from '../tools/edit-diff.js';

function detectLineEnding(content: string): '\r\n' | '\n' {
  const crlfIdx = content.indexOf('\r\n');
  const lfIdx = content.indexOf('\n');
  if (lfIdx === -1) return '\n';
  if (crlfIdx === -1) return '\n';
  return crlfIdx < lfIdx ? '\r\n' : '\n';
}

export function applyPatchToContent(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): { ok: true; next: string; replacements: number } | { ok: false; error: string } {
  if (!oldString) return { ok: false, error: 'old_string is required for patch.' };
  if (newString === undefined) {
    return { ok: false, error: 'new_string is required (use empty string to delete matched text).' };
  }

  const lineEnding = detectLineEnding(content);
  const normalized = normalizeToLF(content);
  const oldN = normalizeToLF(oldString);
  const newN = normalizeToLF(newString);

  if (replaceAll) {
    const parts = normalized.split(oldN);
    const count = parts.length - 1;
    if (count === 0) {
      return { ok: false, error: 'old_string not found for replace_all.' };
    }
    const merged = parts.join(newN);
    return { ok: true, next: restoreLineEndings(merged, lineEnding), replacements: count };
  }

  const match = fuzzyFindText(normalized, oldN);
  if (!match.found) {
    return { ok: false, error: 'old_string not found in file.' };
  }
  const base = match.contentForReplacement;
  const fuzzyContent = normalizeForFuzzyMatch(normalizeToLF(base));
  const fuzzyOld = normalizeForFuzzyMatch(oldN);
  const occurrences = fuzzyOld ? fuzzyContent.split(fuzzyOld).length - 1 : 0;
  if (occurrences > 1) {
    return { ok: false, error: `Found ${occurrences} matches; narrow old_string or use replace_all.` };
  }
  const next =
    base.slice(0, match.index) + newN + base.slice(match.index + match.matchLength);
  return { ok: true, next: restoreLineEndings(next, lineEnding), replacements: 1 };
}

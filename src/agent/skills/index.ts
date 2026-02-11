/**
 * Skill system for xopcbot
 * Simplified implementation following pi-mono/coding-agent
 * Follows Agent Skills specification: https://agentskills.io/specification
 * 
 * Features:
 * - Priority: workspace > global > builtin
 * - .gitignore/.ignore/.fdignore support
 * - Skill collision detection
 * - Detailed diagnostics
 * - Hot reload support
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { basename, dirname, join, relative, sep } from 'path';
import { parseFrontmatter } from '../../utils/frontmatter.js';

/** Max name length per spec */
const MAX_NAME_LENGTH = 64;

/** Max description length per spec */
const MAX_DESCRIPTION_LENGTH = 1024;

/** Ignore file names */
const IGNORE_FILE_NAMES = ['.gitignore', '.ignore', '.fdignore'];

/** Skill diagnostic message */
export interface SkillDiagnostic {
  type: 'warning' | 'collision' | 'error';
  skillName?: string;
  message: string;
  path?: string;
}

/** Skill frontmatter per Agent Skills spec */
export interface SkillFrontmatter {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  'allowed-tools'?: string;
  metadata?: Record<string, string>;
  'disable-model-invocation'?: boolean;
  [key: string]: unknown;
}

/** Core skill interface */
export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: 'builtin' | 'workspace' | 'global';
  disableModelInvocation: boolean;
}

/** Load skills result with diagnostics */
export interface LoadSkillsResult {
  skills: Skill[];
  prompt: string;
  diagnostics: SkillDiagnostic[];
}

/**
 * Convert path to posix format
 */
function toPosixPath(p: string): string {
  return p.split(sep).join('/');
}

/**
 * Prefix ignore pattern with directory prefix
 */
function prefixIgnorePattern(line: string, prefix: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#') && !trimmed.startsWith('\\#')) return null;

  let pattern = line;
  let negated = false;

  if (pattern.startsWith('!')) {
    negated = true;
    pattern = pattern.slice(1);
  } else if (pattern.startsWith('\\!')) {
    pattern = pattern.slice(1);
  }

  if (pattern.startsWith('/')) {
    pattern = pattern.slice(1);
  }

  const prefixed = prefix ? `${prefix}${pattern}` : pattern;
  return negated ? `!${prefixed}` : prefixed;
}

/**
 * Load ignore rules from .gitignore/.ignore files
 */
function loadIgnoreRules(dir: string, rootDir: string): Set<string> {
  const ignoredPaths = new Set<string>();
  const relativeDir = relative(rootDir, dir);
  const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : '';

  for (const filename of IGNORE_FILE_NAMES) {
    const ignorePath = join(dir, filename);
    if (!existsSync(ignorePath)) continue;

    try {
      const content = readFileSync(ignorePath, 'utf-8');
      const lines = content.split(/\r?\n/);
      
      for (const line of lines) {
        const pattern = prefixIgnorePattern(line, prefix);
        if (pattern) {
          const fullPattern = pattern.startsWith('!') 
            ? `!${prefix}${pattern.slice(1)}`
            : `${prefix}${pattern}`;
          ignoredPaths.add(fullPattern);
        }
      }
    } catch {
      // Ignore file read errors
    }
  }

  return ignoredPaths;
}

/**
 * Check if a path should be ignored
 */
function shouldIgnore(path: string, ignoredPaths: Set<string>): boolean {
  // Simple ignore check - check exact matches and prefixes
  for (const pattern of ignoredPaths) {
    if (pattern.startsWith('!')) {
      // Negated pattern - this path is NOT ignored
      const positivePattern = pattern.slice(1);
      if (path === positivePattern || path.startsWith(`${positivePattern}/`)) {
        return false;
      }
    } else {
      // Positive pattern - this path IS ignored
      if (path === pattern || path.startsWith(`${pattern}/`)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Validate skill name
 */
// NOTE: Reserved for future use
export function _validateName(name: string, parentDirName: string): string[] {
  const errors: string[] = [];

  if (name !== parentDirName) {
    errors.push(`name "${name}" does not match parent directory "${parentDirName}"`);
  }

  if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push('name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)');
  }

  if (name.startsWith('-') || name.endsWith('-')) {
    errors.push('name must not start or end with a hyphen');
  }

  if (name.includes('--')) {
    errors.push('name must not contain consecutive hyphens');
  }

  return errors;
}

/**
 * Validate skill description
 */
// NOTE: Reserved for future use
export function _validateDescription(description: string | undefined): string[] {
  const errors: string[] = [];

  if (!description || description.trim() === '') {
    errors.push('description is required');
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`);
  }

  return errors;
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format skill as XML
 */
function formatSkillXml(skill: Skill): string {
  return [
    '  <skill>',
    `    <name>${escapeXml(skill.name)}</name>`,
    `    <description>${escapeXml(skill.description)}</description>`,
    `    <location>${escapeXml(skill.filePath)}</location>`,
    '  </skill>',
  ].join('\n');
}

/**
 * Format skills for system prompt
 */
function formatSkillsForPrompt(skills: Skill[]): string {
  const visibleSkills = skills.filter(s => !s.disableModelInvocation);

  if (visibleSkills.length === 0) {
    return '';
  }

  const lines = [
    '\n\n<available_skills>',
    'Skills are folders of instructions, scripts, and resources.',
    'Use the read tool to load a skill\'s file when the task matches its description.',
    '',
  ];

  for (const skill of visibleSkills) {
    lines.push(formatSkillXml(skill));
  }

  lines.push('</available_skills>');

  return lines.join('\n');
}

/**
 * Discover skills from a directory with ignore support
 */
function discoverSkills(
  dir: string, 
  source: 'builtin' | 'workspace' | 'global'
): Skill[] {
  const skills: Skill[] = [];

  if (!existsSync(dir)) {
    return skills;
  }

  function scan(currentDir: string, currentIgnoredPaths: Set<string>) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.name === 'node_modules') continue;

        const fullPath = join(currentDir, entry.name);
        const relPath = toPosixPath(relative(dir, fullPath));

        // Check if this path should be ignored
        if (shouldIgnore(relPath, currentIgnoredPaths)) {
          continue;
        }

        // Handle directories
        if (entry.isDirectory()) {
          const skillMdPath = join(fullPath, 'SKILL.md');
          const skillRelPath = `${relPath}/`;
          
          // Check for subdirectory ignore files
          const subIgnoredPaths = new Set(currentIgnoredPaths);
          const subIgnoreFile = join(fullPath, '.gitignore');
          if (existsSync(subIgnoreFile)) {
            const subRules = loadIgnoreRules(fullPath, dir);
            for (const rule of subRules) {
              subIgnoredPaths.add(`${skillRelPath}${rule}`);
            }
          }

          if (existsSync(skillMdPath) && !shouldIgnore(skillRelPath, currentIgnoredPaths)) {
            const skill = loadSkillFromFile(skillMdPath, source);
            if (skill) {
              skills.push(skill);
            }
          }
          
          // Recurse into subdirectories
          scan(fullPath, subIgnoredPaths);
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  // Load ignore rules from root directory
  const rootIgnoredPaths = loadIgnoreRules(dir, dir);
  scan(dir, rootIgnoredPaths);

  return skills;
}

/**
 * Load a skill from a markdown file
 */
function loadSkillFromFile(filePath: string, source: 'builtin' | 'workspace' | 'global'): Skill | null {
  try {
    const rawContent = readFileSync(filePath, 'utf-8');
    const { frontmatter } = parseFrontmatter<SkillFrontmatter>(rawContent);
    const skillDir = dirname(filePath);
    const parentDirName = basename(skillDir);

    // Get name (frontmatter or directory name)
    const name = (frontmatter.name as string | undefined) || parentDirName;

    // Get description (required)
    const description = frontmatter.description as string | undefined;
    if (!description || description.trim() === '') {
      return null;
    }

    return {
      name,
      description: description.trim(),
      filePath,
      baseDir: skillDir,
      source,
      disableModelInvocation: frontmatter['disable-model-invocation'] === true,
    };
  } catch {
    return null;
  }
}

/**
 * Load skills from multiple directories with priority
 * Priority: workspace > global > builtin
 */
export function loadSkills(options: {
  workspaceDir?: string;
  globalDir?: string;
  builtinDir?: string;
}): LoadSkillsResult {
  const { workspaceDir, globalDir, builtinDir } = options;

  const skillMap = new Map<string, Skill>();
  const diagnostics: SkillDiagnostic[] = [];

  // Priority 1: Built-in skills (lowest)
  if (builtinDir) {
    for (const skill of discoverSkills(builtinDir, 'builtin')) {
      const existing = skillMap.get(skill.name);
      if (existing) {
        diagnostics.push({
          type: 'collision',
          skillName: skill.name,
          message: `Skill "${skill.name}" collision: ${existing.source} overrides ${skill.source}`,
          path: skill.filePath,
        });
      } else {
        skillMap.set(skill.name, skill);
      }
    }
  }

  // Priority 2: Global skills
  if (globalDir) {
    for (const skill of discoverSkills(globalDir, 'global')) {
      const existing = skillMap.get(skill.name);
      if (existing) {
        diagnostics.push({
          type: 'collision',
          skillName: skill.name,
          message: `Skill "${skill.name}" collision: ${existing.source} overrides ${skill.source}`,
          path: skill.filePath,
        });
      } else {
        skillMap.set(skill.name, skill);
      }
    }
  }

  // Priority 3: Workspace skills (highest, overrides others)
  if (workspaceDir) {
    const workspaceSkills = discoverSkills(join(workspaceDir, 'skills'), 'workspace');
    for (const skill of workspaceSkills) {
      const existing = skillMap.get(skill.name);
      if (existing) {
        diagnostics.push({
          type: 'collision',
          skillName: skill.name,
          message: `Skill "${skill.name}" collision: ${skill.source} overrides ${existing.source}`,
          path: skill.filePath,
        });
      }
      skillMap.set(skill.name, skill);
    }
  }

  const skills = Array.from(skillMap.values());
  const prompt = formatSkillsForPrompt(skills);

  return { skills, prompt, diagnostics };
}

/**
 * Create a skill loader with hot reload support
 */
export function createSkillLoader() {
  let cachedSkills: Skill[] = [];
  let cachedPrompt: string = '';
  let cachedDiagnostics: SkillDiagnostic[] = [];
  let lastLoadTime = 0;

  return {
    /**
     * Load skills (with caching)
     */
    load: (options: {
      workspaceDir?: string;
      globalDir?: string;
      builtinDir?: string;
    }): LoadSkillsResult => {
      const result = loadSkills(options);
      cachedSkills = result.skills;
      cachedPrompt = result.prompt;
      cachedDiagnostics = result.diagnostics;
      lastLoadTime = Date.now();
      return result;
    },

    /**
     * Force reload skills (hot reload)
     */
    reload: (options: {
      workspaceDir?: string;
      globalDir?: string;
      builtinDir?: string;
    }): LoadSkillsResult => {
      const result = loadSkills(options);
      cachedSkills = result.skills;
      cachedPrompt = result.prompt;
      cachedDiagnostics = result.diagnostics;
      lastLoadTime = Date.now();
      return result;
    },

    /**
     * Get cached skills
     */
    getSkills: () => cachedSkills,

    /**
     * Get cached prompt
     */
    getPrompt: () => cachedPrompt,

    /**
     * Get cached diagnostics
     */
    getDiagnostics: () => cachedDiagnostics,

    /**
     * Get last load time
     */
    getLastLoadTime: () => lastLoadTime,
  };
}

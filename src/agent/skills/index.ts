/**
 * Skill system for xopcbot
 * Simplified implementation following pi-mono/coding-agent
 * Follows Agent Skills specification: https://agentskills.io/specification
 * 
 * Priority: workspace > global > builtin
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { parseFrontmatter } from '../../utils/frontmatter.js';

/** Max name length per spec */
const MAX_NAME_LENGTH = 64;

/** Max description length per spec */
const MAX_DESCRIPTION_LENGTH = 1024;

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

/** Load skills result */
export interface LoadSkillsResult {
  skills: Skill[];
  prompt: string;
}

/**
 * Validate skill name
 */
// NOTE: Name validation is deferred to discovery time
function _validateName(name: string, parentDirName: string): string[] {
  const errors: string[] = [];

  if (name !== parentDirName) {
    errors.push(`name "${name}" does not match parent directory "${parentDirName}"`);
  }

  if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push(`name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)`);
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
// NOTE: Description validation is deferred to discovery time
function _validateDescription(description: string | undefined): string[] {
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
 * Discover skills from a directory
 */
function discoverSkills(dir: string, source: 'builtin' | 'workspace' | 'global'): Skill[] {
  const skills: Skill[] = [];

  if (!existsSync(dir)) {
    return skills;
  }

  function scan(currentDir: string) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.name === 'node_modules') continue;

        const fullPath = join(currentDir, entry.name);

        // Handle directories
        if (entry.isDirectory()) {
          const skillMdPath = join(fullPath, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            const skill = loadSkillFromFile(skillMdPath, source);
            if (skill) {
              skills.push(skill);
            }
          }
          // Recurse into subdirectories
          scan(fullPath);
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  scan(dir);
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

  // Priority 1: Built-in skills (lowest)
  if (builtinDir) {
    for (const skill of discoverSkills(builtinDir, 'builtin')) {
      skillMap.set(skill.name, skill);
    }
  }

  // Priority 2: Global skills
  if (globalDir) {
    for (const skill of discoverSkills(globalDir, 'global')) {
      skillMap.set(skill.name, skill);
    }
  }

  // Priority 3: Workspace skills (highest, overrides others)
  if (workspaceDir) {
    const workspaceSkills = discoverSkills(join(workspaceDir, 'skills'), 'workspace');
    for (const skill of workspaceSkills) {
      skillMap.set(skill.name, skill);
    }
  }

  const skills = Array.from(skillMap.values());
  const prompt = formatSkillsForPrompt(skills);

  return { skills, prompt };
}

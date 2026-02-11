#!/usr/bin/env tsx
/**
 * Skill validator CLI
 * Validates SKILL.md files against Agent Skills spec
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { parseFrontmatter } from '../src/utils/frontmatter.js';

interface Diagnostic {
  type: 'error' | 'warning';
  message: string;
  file: string;
}

interface SkillInfo {
  name: string;
  filePath: string;
  diagnostics: Diagnostic[];
}

const REQUIRED_FIELDS = ['name', 'description'];

/**
 * Check if a file should be ignored
 */
function shouldIgnore(name: string): boolean {
  if (name.startsWith('.')) return true;
  if (name === 'node_modules') return true;
  if (name.endsWith('.md.bak')) return true;
  return false;
}

/**
 * Validate a single skill file
 */
function validateSkill(filePath: string): SkillInfo {
  const diagnostics: Diagnostic[] = [];

  try {
    const rawContent = readFileSync(filePath, 'utf-8');
    const { frontmatter } = parseFrontmatter(rawContent);

    // Check required fields
    for (const field of REQUIRED_FIELDS) {
      if (!frontmatter[field]) {
        diagnostics.push({
          type: 'error',
          message: `Missing required field: ${field}`,
          file: filePath
        });
      }
    }

    // Check name format (kebab-case)
    const name = frontmatter.name as string | undefined;
    if (name && !/^[a-z][a-z0-9-]*$/.test(name)) {
      diagnostics.push({
        type: 'warning',
        message: `Skill name should be kebab-case: "${name}"`,
        file: filePath
      });
    }

    // Check for deprecated xopcbot metadata
    if (frontmatter.metadata && typeof frontmatter.metadata === 'object') {
      const meta = frontmatter.metadata as Record<string, unknown>;
      if (meta.xopcbot) {
        diagnostics.push({
          type: 'warning',
          message: 'Deprecated xopcbot metadata found. Use top-level fields instead.',
          file: filePath
        });
      }
    }

    // Check for deprecated fields
    const deprecatedFields = ['invoke_as', 'disable-model-invocation'];
    for (const field of deprecatedFields) {
      if (frontmatter[field]) {
        diagnostics.push({
          type: 'warning',
          message: `Deprecated field: ${field}. Agent decides invocation.`,
          file: filePath
        });
      }
    }

  } catch (error) {
    diagnostics.push({
      type: 'error',
      message: `Failed to parse: ${error instanceof Error ? error.message : String(error)}`,
      file: filePath
    });
  }

  const skillName = filePath.split('/').slice(-2, -1)[0] || 'unknown';
  
  return {
    name: skillName,
    filePath,
    diagnostics
  };
}

/**
 * Discover and validate skills in a directory
 */
function validateDirectory(dir: string): SkillInfo[] {
  const skills: SkillInfo[] = [];

  function scan(currentDir: string) {
    try {
      const entries = require('fs').readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (shouldIgnore(entry.name)) continue;

        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          const skillMdPath = join(fullPath, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            skills.push(validateSkill(skillMdPath));
          }
          scan(fullPath);
        }
      }
    } catch (error) {
      console.error(`Failed to scan ${dir}: ${error}`);
    }
  }

  if (existsSync(dir)) {
    scan(dir);
  }

  return skills;
}

/**
 * Main CLI
 */
async function main() {
  const args = process.argv.slice(2);
  const target = args[0] || 'skills';

  console.log(`Validating skills in: ${target}\n`);

  let skills: SkillInfo[];

  if (statSync(target).isDirectory()) {
    skills = validateDirectory(target);
  } else {
    skills = [validateSkill(target)];
  }

  let hasErrors = false;

  for (const skill of skills) {
    const baseName = relative(target, skill.filePath) || skill.name;

    if (skill.diagnostics.length === 0) {
      console.log(`✅ ${baseName}`);
    } else {
      for (const diag of skill.diagnostics) {
        const prefix = diag.type === 'error' ? '❌' : '⚠️';
        console.log(`${prefix} ${baseName}: ${diag.message}`);
      }
      if (skill.diagnostics.some(d => d.type === 'error')) {
        hasErrors = true;
      }
    }
  }

  console.log(`\nValidated ${skills.length} skills`);

  process.exit(hasErrors ? 1 : 0);
}

main().catch(console.error);

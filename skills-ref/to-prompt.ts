#!/usr/bin/env tsx
/**
 * Generate <available_skills> XML for agent prompts
 */

import { existsSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { parseFrontmatter } from '../src/utils/frontmatter.js';

interface Skill {
  name: string;
  description: string;
  filePath: string;
}

/**
 * Load a single skill
 */
function loadSkill(filePath: string): Skill | null {
  try {
    const rawContent = readFileSync(filePath, 'utf-8');
    const { frontmatter } = parseFrontmatter(rawContent);

    const name = frontmatter.name as string | undefined;
    const description = frontmatter.description as string | undefined;

    if (!name || !description) {
      return null;
    }

    return { name, description, filePath };
  } catch {
    return null;
  }
}

/**
 * Discover skills in a directory
 */
function discoverSkills(dir: string): Skill[] {
  const skills: Skill[] = [];

  function scan(currentDir: string) {
    try {
      const entries = require('fs').readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;

        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          const skillMdPath = join(fullPath, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            const skill = loadSkill(skillMdPath);
            if (skill) skills.push(skill);
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
 * Escape XML
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
 * Format as XML
 */
function formatAsXml(skills: Skill[]): string {
  const lines = ['<available_skills>'];

  for (const skill of skills) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push('  </skill>');
  }

  lines.push('</available_skills>');

  return lines.join('\n');
}

/**
 * Main CLI
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: tsx to-prompt.ts <skill-dir-1> <skill-dir-2> ...');
    console.log('\nExamples:');
    console.log('  tsx to-prompt.ts skills/');
    console.log('  tsx to-prompt.ts skills/weather skills/github');
    process.exit(1);
  }

  const allSkills: Skill[] = [];

  for (const arg of args) {
    const skills = discoverSkills(arg);
    allSkills.push(...skills);
  }

  const xml = formatAsXml(allSkills);
  console.log(xml);
}

main().catch(console.error);

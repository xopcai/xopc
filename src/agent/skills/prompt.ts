/**
 * Skill prompt formatting - generate XML prompts for LLM
 * Follows Claude Code / Agent Skills standard format
 */

import type { Skill } from './types.js';

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
 * Format a single skill for XML output
 */
function formatSkillXml(skill: Skill): string {
  const lines = [
    '  <skill>',
    `    <name>${escapeXml(skill.name)}</name>`,
    `    <description>${escapeXml(skill.description)}</description>`,
    `    <location>${escapeXml(skill.filePath)}</location>`,
  ];

  // Add metadata if present
  if (skill.metadata) {
    if (skill.metadata.emoji) {
      lines.push(`    <emoji>${escapeXml(skill.metadata.emoji)}</emoji>`);
    }
    if (skill.metadata.category) {
      lines.push(`    <category>${escapeXml(skill.metadata.category)}</category>`);
    }
  }

  lines.push('  </skill>');
  return lines.join('\n');
}

/**
 * Format skills for inclusion in system prompt
 * Uses XML format per Agent Skills standard
 * 
 * Skills with disableModelInvocation=true are excluded
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  // Filter out skills disabled for model invocation
  const visibleSkills = skills.filter(s => !s.disableModelInvocation);

  if (visibleSkills.length === 0) {
    return '';
  }

  const lines = [
    '\n\nThe following skills provide specialized instructions for specific tasks.',
    'Use the read tool to load a skill\'s file when the task matches its description.',
    'When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.',
    '',
    '<available_skills>',
  ];

  for (const skill of visibleSkills) {
    lines.push(formatSkillXml(skill));
  }

  lines.push('</available_skills>');

  return lines.join('\n');
}

/**
 * Format skills as a simple list (for commands like /skills)
 */
export function formatSkillsList(skills: Skill[]): string {
  if (skills.length === 0) {
    return 'No skills available.';
  }

  const lines = ['Available skills:'];

  for (const skill of skills) {
    const emoji = skill.metadata?.emoji || '📄';
    const status = skill.disableModelInvocation ? ' (manual only)' : '';
    lines.push(`  ${emoji} **${skill.name}** - ${skill.description}${status}`);
  }

  return lines.join('\n');
}

/**
 * Format skill details (for /skill info command)
 */
export function formatSkillDetail(skill: Skill): string {
  const lines = [
    `# ${skill.metadata?.emoji || '📄'} ${skill.name}`,
    '',
    `**Description:** ${skill.description}`,
    `**Source:** ${skill.source}`,
    `**Path:** \`${skill.filePath}\``,
  ];

  if (skill.metadata) {
    lines.push('');
    lines.push('**Metadata:**');
    
    if (skill.metadata.category) {
      lines.push(`- Category: ${skill.metadata.category}`);
    }
    if (skill.metadata.invoke_as) {
      lines.push(`- Invoke as: ${skill.metadata.invoke_as}`);
    }
    if (skill.metadata.requires) {
      if (skill.metadata.requires.bins?.length) {
        lines.push(`- Requires binaries: ${skill.metadata.requires.bins.join(', ')}`);
      }
      if (skill.metadata.requires.env?.length) {
        lines.push(`- Requires env vars: ${skill.metadata.requires.env.join(', ')}`);
      }
    }
  }

  if (skill.disableModelInvocation) {
    lines.push('');
    lines.push('*This skill is disabled for automatic model invocation.*');
  }

  return lines.join('\n');
}

/**
 * Create a compact skills summary for logging/debugging
 */
export function formatSkillsSummary(skills: Skill[]): string {
  return skills.map(s => {
    const emoji = s.metadata?.emoji || '📄';
    return `${emoji} ${s.name} (${s.source})`;
  }).join(', ');
}

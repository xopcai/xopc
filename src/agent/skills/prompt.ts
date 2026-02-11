/**
 * Skill prompt formatting - generate XML prompts for LLM
 * Follows Agent Skills specification (https://agentskills.io/specification)
 * 
 * Format: <available_skills> XML block for system prompts
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
 * Per Agent Skills spec: <skill><name>, <description>, <location></skill>
 */
function formatSkillXml(skill: Skill): string {
  const lines = [
    '  <skill>',
    `    <name>${escapeXml(skill.name)}</name>`,
    `    <description>${escapeXml(skill.description)}</description>`,
    `    <location>${escapeXml(skill.filePath)}</location>`,
  ];

  // Add optional license if present
  if (skill.frontmatter.license) {
    lines.push(`    <license>${escapeXml(skill.frontmatter.license)}</license>`);
  }

  // Add optional compatibility if present
  if (skill.frontmatter.compatibility) {
    lines.push(`    <compatibility>${escapeXml(skill.frontmatter.compatibility)}</compatibility>`);
  }

  lines.push('  </skill>');
  return lines.join('\n');
}

/**
 * Format skills for inclusion in system prompt
 * Uses XML format per Agent Skills standard
 * 
 * Skills with frontmatter.disable-model-invocation=true are excluded
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  // Filter out skills disabled for model invocation
  const visibleSkills = skills.filter(s => !s.frontmatter['disable-model-invocation']);

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
 * Format skills as a simple list (for CLI /skills command)
 */
export function formatSkillsList(skills: Skill[]): string {
  if (skills.length === 0) {
    return 'No skills available.';
  }

  const lines = ['Available skills:'];

  for (const skill of skills) {
    const emoji = skill.metadata?.emoji || skill.frontmatter['xopcbot-metadata']?.emoji || '📄';
    const status = skill.frontmatter['disable-model-invocation'] ? ' (manual only)' : '';
    lines.push(`  ${emoji} **${skill.name}** - ${skill.description}${status}`);
  }

  return lines.join('\n');
}

/**
 * Format skill details (for /skill info command)
 */
export function formatSkillDetail(skill: Skill): string {
  const oldMetadata = skill.frontmatter['xopcbot-metadata'];
  const newMetadata = skill.metadata;

  const lines = [
    `# ${oldMetadata?.emoji || newMetadata?.emoji || '📄'} ${skill.name}`,
    '',
    `**Description:** ${skill.description}`,
    `**Source:** ${skill.source}`,
    `**Path:** \`${skill.filePath}\``,
  ];

  if (skill.frontmatter.license) {
    lines.push(`**License:** ${skill.frontmatter.license}`);
  }

  if (skill.frontmatter.compatibility) {
    lines.push(`**Compatibility:** ${skill.frontmatter.compatibility}`);
  }

  // Show deprecated xopcbot metadata if present
  if (oldMetadata) {
    lines.push('');
    lines.push('**xopcbot config** (deprecated):');
    
    if (oldMetadata.category) {
      lines.push(`- Category: ${oldMetadata.category}`);
    }
    if (oldMetadata.invoke_as) {
      lines.push(`- Invoke as: ${oldMetadata.invoke_as}`);
    }
    if (oldMetadata.requires) {
      if (oldMetadata.requires.bins?.length) {
        lines.push(`- Requires binaries: ${oldMetadata.requires.bins.join(', ')}`);
      }
      if (oldMetadata.requires.env?.length) {
        lines.push(`- Requires env vars: ${oldMetadata.requires.env.join(', ')}`);
      }
    }
  }

  if (skill.frontmatter['disable-model-invocation']) {
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
    const emoji = s.metadata?.emoji || s.frontmatter['xopcbot-metadata']?.emoji || '📄';
    return `${emoji} ${s.name} (${s.source})`;
  }).join(', ');
}

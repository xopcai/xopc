/**
 * Build `<available_skills>` XML block for the system prompt.
 */

import { createSkillConfigManager, isSkillEnabled } from './config.js';
import type { Skill } from './types.js';
import type { SkillsConfig } from './types.js';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatSkillXml(skill: Skill): string {
  const emoji = skill.metadata.emoji || '';
  const emojiStr = emoji ? `${emoji} ` : '';

  return [
    '  <skill>',
    `    <name>${escapeXml(skill.name)}</name>`,
    `    <description>${emojiStr}${escapeXml(skill.description)}</description>`,
    `    <location>${escapeXml(skill.filePath)}</location>`,
    '  </skill>',
  ].join('\n');
}

export function formatSkillsForPrompt(skills: Skill[], skillsConfig?: SkillsConfig): string {
  const visibleSkills = skills.filter(
    (s) => !s.disableModelInvocation && isSkillEnabled(s, skillsConfig),
  );
  if (visibleSkills.length === 0) return '';

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

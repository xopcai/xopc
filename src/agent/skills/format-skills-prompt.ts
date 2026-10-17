/**
 * Build `<available_skills>` XML block for the system prompt.
 */

import { isSkillEnabled } from './config.js';
import { skillVisibleForRegisteredTools } from './skill-tool-gating.js';
import type { Skill } from './types.js';
import type { SkillsConfig } from './types.js';

export interface FormatSkillsForPromptOptions {
  /** Explicit skill names visible in this context. Omitted means all enabled skills; empty means no visible skills. */
  skillAllowlist?: string[];
  /** When set (including empty array), applies tool gating from skill frontmatter. */
  registeredToolNames?: string[];
}

export function selectSkillsVisibleInPrompt(
  skills: Skill[],
  skillsConfig?: SkillsConfig,
  options?: FormatSkillsForPromptOptions,
): Skill[] {
  let list = skills;

  if (options?.skillAllowlist !== undefined) {
    if (options.skillAllowlist.length === 0) {
      return [];
    }
    const allow = new Set(options.skillAllowlist.map((s) => s.toLowerCase()));
    list = list.filter((s) => allow.has(s.name.toLowerCase()));
  }

  list = list.filter((s) => !s.disableModelInvocation && isSkillEnabled(s, skillsConfig));

  if (skillsConfig?.toolGating !== false && options?.registeredToolNames !== undefined) {
    const at = new Set(options.registeredToolNames);
    list = list.filter((s) => skillVisibleForRegisteredTools(s, at));
  }

  return list;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatSkillXmlMetadataOnly(skill: Skill): string {
  const emoji = skill.metadata.emoji || '';
  const emojiStr = emoji ? `${emoji} ` : '';

  return [
    '  <skill>',
    `    <name>${escapeXml(skill.name)}</name>`,
    `    <description>${emojiStr}${escapeXml(skill.description)}</description>`,
    '  </skill>',
  ].join('\n');
}

export function formatSkillsForPrompt(
  skills: Skill[],
  skillsConfig?: SkillsConfig,
  options?: FormatSkillsForPromptOptions,
): string {
  const registered = options?.registeredToolNames;
  const view = registered?.find(name => name.trim().toLowerCase() === 'skill_view')?.trim();
  if (registered !== undefined && !view) return '';
  const visibleSkills = selectSkillsVisibleInPrompt(skills, skillsConfig, options);
  if (visibleSkills.length === 0) return '';
  const maxSkills = skillsConfig?.limits?.maxSkillsInPrompt;
  const selectedSkills = maxSkills === undefined ? visibleSkills : visibleSkills.slice(0, maxSkills);

  const lines = [
    '\n\n<available_skills>',
    'Skills contain reusable procedures and resources.',
    `Use ${view ?? 'skill_view'}(name, path) for referenced resources.`,
    '',
  ];

  const maxChars = skillsConfig?.limits?.maxSkillsPromptChars;
  for (const skill of selectedSkills) {
    const next = formatSkillXmlMetadataOnly(skill);
    const candidate = [...lines, next, '</available_skills>'].join('\n');
    if (maxChars !== undefined && candidate.length > maxChars) break;
    lines.push(next);
  }

  if (lines.length === 4) return '';
  lines.push('</available_skills>');
  return lines.join('\n');
}

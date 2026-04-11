/**
 * Build `<available_skills>` XML block for the system prompt.
 */

import { createSkillConfigManager, isSkillEnabled } from './config.js';
import { skillVisibleForRegisteredTools } from './skill-tool-gating.js';
import type { Skill } from './types.js';
import type { SkillsConfig } from './types.js';

export interface FormatSkillsForPromptOptions {
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

  if (options?.skillAllowlist?.length) {
    const allow = new Set(options.skillAllowlist.map((s) => s.toLowerCase()));
    list = list.filter((s) => allow.has(s.name.toLowerCase()));
  } else if (options?.skillAllowlist?.length === 0) {
    return [];
  }

  list = list.filter((s) => !s.disableModelInvocation && isSkillEnabled(s, skillsConfig));

  if (skillsConfig?.toolGating !== false && options?.registeredToolNames !== undefined) {
    const at = new Set(options.registeredToolNames);
    list = list.filter((s) => skillVisibleForRegisteredTools(s, at));
  }

  return list;
}

/** Default matches Hermes-style progressive disclosure (no paths in the system prompt). */
export function effectiveSkillsPromptStyle(skillsConfig?: SkillsConfig): 'metadata-only' | 'legacy-with-paths' {
  return skillsConfig?.promptStyle === 'legacy-with-paths' ? 'legacy-with-paths' : 'metadata-only';
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatSkillXmlLegacy(skill: Skill): string {
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
  const visibleSkills = selectSkillsVisibleInPrompt(skills, skillsConfig, options);
  if (visibleSkills.length === 0) return '';

  const style = effectiveSkillsPromptStyle(skillsConfig);
  const lines =
    style === 'legacy-with-paths'
      ? [
          '\n\n<available_skills>',
          'Skills are folders of instructions, scripts, and resources.',
          'Use the read tool to load a skill\'s file when the task matches its description.',
          '',
        ]
      : [
          '\n\n<available_skills>',
          'Skills are folders of instructions, scripts, and resources.',
          'Use skills_list to browse; use skill_view(name) for SKILL.md or skill_view(name, path) for references/, templates/, scripts/, or assets/.',
          '',
        ];

  for (const skill of visibleSkills) {
    lines.push(
      style === 'legacy-with-paths' ? formatSkillXmlLegacy(skill) : formatSkillXmlMetadataOnly(skill),
    );
  }

  lines.push('</available_skills>');
  return lines.join('\n');
}

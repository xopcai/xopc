/**
 * Build `<available_skills>` XML block for the system prompt.
 *
 * Keeps the catalog bounded and deterministic (prompt-cache friendly):
 * 1. Sorts inline skills by pinned -> origin.priority desc -> name asc.
 * 2. Renders full `<skill>` blocks within budget, then falls back to compact
 *    `<skill name="..." category="..."/>` entries before omitting skills.
 * 3. Appends a `<more_skills>` summary whenever skills are omitted or deferred.
 */

import { isSkillEnabled, resolveSkillConfig } from './config.js';
import { skillVisibleForRegisteredTools } from './skill-tool-gating.js';
import type { Skill, SkillsConfig } from './types.js';

export const DEFAULT_MAX_SKILLS_IN_PROMPT = 50;
export const DEFAULT_MAX_SKILLS_PROMPT_CHARS = 12_000;
export const DEFAULT_MAX_DESCRIPTION_CHARS_IN_PROMPT = 180;

const MAX_MORE_SKILLS_CATEGORIES = 12;

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

export function compareSkillsForPrompt(
  left: Skill,
  right: Skill,
  skillsConfig?: SkillsConfig,
): number {
  const leftPinned = resolveSkillConfig(left, skillsConfig).pinned === true ? 1 : 0;
  const rightPinned = resolveSkillConfig(right, skillsConfig).pinned === true ? 1 : 0;
  if (leftPinned !== rightPinned) {
    return rightPinned - leftPinned;
  }

  const leftPriority = left.origin?.priority ?? 0;
  const rightPriority = right.origin?.priority ?? 0;
  if (leftPriority !== rightPriority) {
    return rightPriority - leftPriority;
  }

  return left.name.localeCompare(right.name);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncateDescription(description: string, maxChars: number): string {
  const normalized = description.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function formatSkillXmlFull(skill: Skill, maxDescriptionChars: number): string {
  const emoji = skill.metadata.emoji || '';
  const emojiStr = emoji ? `${emoji} ` : '';
  const desc = truncateDescription(skill.description, maxDescriptionChars);

  return [
    '  <skill>',
    `    <name>${escapeXml(skill.name)}</name>`,
    `    <description>${emojiStr}${escapeXml(desc)}</description>`,
    '  </skill>',
  ].join('\n');
}

function formatSkillXmlCompact(skill: Skill): string {
  const categoryAttr = skill.category ? ` category="${escapeXml(skill.category)}"` : '';
  return `  <skill name="${escapeXml(skill.name)}"${categoryAttr}/>`;
}

function summarizeCategories(skills: Skill[]): string {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    const key = skill.category?.trim() || 'uncategorized';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  if (sorted.length <= MAX_MORE_SKILLS_CATEGORIES) {
    return sorted.map(([cat, count]) => `${cat}(${count})`).join(', ');
  }

  const head = sorted.slice(0, MAX_MORE_SKILLS_CATEGORIES);
  const otherCount = sorted
    .slice(MAX_MORE_SKILLS_CATEGORIES)
    .reduce((sum, [, count]) => sum + count, 0);
  return [...head.map(([cat, count]) => `${cat}(${count})`), `other(${otherCount})`].join(', ');
}

function buildMoreSkillsXml(omittedSkills: Skill[], listTool?: string, compact = false): string {
  const count = omittedSkills.length;
  if (count === 0) return '';

  if (compact) {
    const hint = listTool ? ` Use ${escapeXml(listTool)}(query) to search.` : '';
    return `  <more_skills omitted="${count}">${count} more skills omitted.${hint}</more_skills>`;
  }

  const categories = summarizeCategories(omittedSkills);
  const guidance = listTool
    ? `${count} additional skills are not expanded here. Use ${escapeXml(listTool)}(query="...") or ${escapeXml(listTool)}(category="...") to discover them before assuming a skill is unavailable.`
    : `${count} additional skills are omitted due to prompt budget.`;

  return [
    `  <more_skills omitted="${count}" categories="${escapeXml(categories)}">`,
    `    ${guidance}`,
    '  </more_skills>',
  ].join('\n');
}

function assemblePrompt(
  headerLines: string[],
  entryLines: string[],
  omittedSkills: Skill[],
  listTool: string | undefined,
  compactFooter = false,
): string {
  const lines = [...headerLines, ...entryLines];
  if (omittedSkills.length > 0) {
    lines.push(buildMoreSkillsXml(omittedSkills, listTool, compactFooter));
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

function fitFooterForOmitted(
  headerLines: string[],
  entryLines: string[],
  omittedSkills: Skill[],
  listTool: string | undefined,
  maxChars: number,
): string | null {
  const withFullFooter = assemblePrompt(headerLines, entryLines, omittedSkills, listTool, false);
  if (withFullFooter.length <= maxChars) return withFullFooter;
  if (omittedSkills.length === 0) return null;

  const withCompactFooter = assemblePrompt(headerLines, entryLines, omittedSkills, listTool, true);
  return withCompactFooter.length <= maxChars ? withCompactFooter : null;
}

export function formatSkillsForPrompt(
  skills: Skill[],
  skillsConfig?: SkillsConfig,
  options?: FormatSkillsForPromptOptions,
): string {
  const registered = options?.registeredToolNames;
  const view = registered?.find((name) => name.trim().toLowerCase() === 'skill_view')?.trim();
  if (registered !== undefined && !view) return '';

  const listTool =
    registered === undefined
      ? 'skills_list'
      : registered.find((name) => name.trim().toLowerCase() === 'skills_list')?.trim();

  const visibleSkills = selectSkillsVisibleInPrompt(skills, skillsConfig, options);
  if (visibleSkills.length === 0) return '';

  const inlinePool: Skill[] = [];
  const deferredPool: Skill[] = [];
  for (const skill of visibleSkills) {
    if (resolveSkillConfig(skill, skillsConfig).exposure === 'deferred') {
      deferredPool.push(skill);
    } else {
      inlinePool.push(skill);
    }
  }
  inlinePool.sort((a, b) => compareSkillsForPrompt(a, b, skillsConfig));

  const maxSkills = skillsConfig?.limits?.maxSkillsInPrompt ?? DEFAULT_MAX_SKILLS_IN_PROMPT;
  const maxChars = skillsConfig?.limits?.maxSkillsPromptChars ?? DEFAULT_MAX_SKILLS_PROMPT_CHARS;
  const maxDescChars =
    skillsConfig?.limits?.maxDescriptionCharsInPrompt ?? DEFAULT_MAX_DESCRIPTION_CHARS_IN_PROMPT;

  const candidates = inlinePool.slice(0, maxSkills);
  const baseOmitted = [...inlinePool.slice(maxSkills), ...deferredPool];

  const headerLines = [
    '\n\n<available_skills>',
    'Skills contain reusable procedures and resources.',
    `Use ${view ?? 'skill_view'}(name, path) for referenced resources.`,
    '',
  ];

  // If all visible skills are explicitly deferred, emit only the discovery notice when listTool exists.
  if (candidates.length === 0) {
    if (!listTool) return '';
    return fitFooterForOmitted(headerLines, [], baseOmitted, listTool, maxChars) ?? '';
  }

  const entryLines: string[] = [];
  const omittedFromBudget: Skill[] = [];
  let compactMode = false;

  for (let i = 0; i < candidates.length; i++) {
    const skill = candidates[i];
    const remainingAfterThis = [...candidates.slice(i + 1), ...baseOmitted];

    if (!compactMode) {
      const fullEntry = formatSkillXmlFull(skill, maxDescChars);
      const fitted = fitFooterForOmitted(
        headerLines,
        [...entryLines, fullEntry],
        remainingAfterThis,
        listTool,
        maxChars,
      );
      if (fitted !== null) {
        entryLines.push(fullEntry);
        continue;
      }
      compactMode = true;
    }

    const compactEntry = formatSkillXmlCompact(skill);
    const fittedCompact = fitFooterForOmitted(
      headerLines,
      [...entryLines, compactEntry],
      remainingAfterThis,
      listTool,
      maxChars,
    );
    if (fittedCompact !== null) {
      entryLines.push(compactEntry);
    } else {
      omittedFromBudget.push(...candidates.slice(i));
      break;
    }
  }

  if (entryLines.length === 0) return '';

  const allOmitted = [...omittedFromBudget, ...baseOmitted];
  return fitFooterForOmitted(headerLines, entryLines, allOmitted, listTool, maxChars) ?? '';
}

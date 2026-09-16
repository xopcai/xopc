export interface SkillLocalization {
  displayName: string;
  description: string;
}

export type SkillLocalizations = Partial<Record<'en' | 'zh-CN', SkillLocalization>>;

export interface LocalizableSkill {
  name: string;
  description: string;
  localizations?: SkillLocalizations;
}

export interface SkillPresentation {
  displayName: string;
  description: string;
  aliases: string[];
  searchTerms: string[];
}

export function resolveSkillPresentation(skill: LocalizableSkill, language: string): SkillPresentation {
  const locale = language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  const selected = skill.localizations?.[locale] ?? skill.localizations?.en;
  const displayName = selected?.displayName.trim() || skill.name;
  const description = selected?.description.trim() || skill.description;
  const aliases = new Set<string>([skill.name]);
  const searchTerms = new Set<string>([skill.description]);
  for (const localization of Object.values(skill.localizations ?? {})) {
    if (localization?.displayName.trim()) aliases.add(localization.displayName.trim());
    if (localization?.description.trim()) searchTerms.add(localization.description.trim());
  }
  aliases.delete(displayName);
  searchTerms.delete(description);
  return { displayName, description, aliases: [...aliases], searchTerms: [...searchTerms] };
}

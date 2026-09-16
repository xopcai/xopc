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
}

export function resolveSkillPresentation(skill: LocalizableSkill, language: string): SkillPresentation {
  const locale = language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  const selected = skill.localizations?.[locale] ?? skill.localizations?.en;
  const displayName = selected?.displayName.trim() || skill.name;
  const description = selected?.description.trim() || skill.description;
  const aliases = new Set<string>([skill.name]);
  for (const localization of Object.values(skill.localizations ?? {})) {
    if (localization?.displayName.trim()) aliases.add(localization.displayName.trim());
  }
  aliases.delete(displayName);
  return { displayName, description, aliases: [...aliases] };
}

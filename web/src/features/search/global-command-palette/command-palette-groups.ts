import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

function commandPaletteGroups(language: StoredLanguage) {
  return messages(language).commandPalette.groups;
}

function commandPaletteGroupOrder(language: StoredLanguage): Record<string, number> {
  const g = commandPaletteGroups(language);
  return {
    [g.navigate]: 0,
    [g.projects]: 1,
    [g.quickSettings]: 2,
    [g.extensions]: 3,
    [g.sessions]: 4,
    [g.files]: 5,
    [g.commands]: 6,
    [g.skills]: 7,
    [g.actions]: 8,
  };
}

export function commandPaletteGroupCaps(language: StoredLanguage): Record<string, number> {
  const g = commandPaletteGroups(language);
  return {
    [g.navigate]: 12,
    [g.projects]: 8,
    [g.quickSettings]: 12,
    [g.actions]: 8,
    [g.extensions]: 8,
    [g.sessions]: 8,
    [g.files]: 10,
    [g.commands]: 6,
    [g.skills]: 6,
  };
}

export function commandPaletteGroupSortKey(
  language: StoredLanguage,
  groupLabel: string,
): number {
  return commandPaletteGroupOrder(language)[groupLabel] ?? 10;
}

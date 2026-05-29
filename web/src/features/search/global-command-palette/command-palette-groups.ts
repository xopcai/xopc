import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

function commandPaletteGroups(language: StoredLanguage) {
  return messages(language).commandPalette.groups;
}

function commandPaletteGroupOrder(language: StoredLanguage): Record<string, number> {
  const g = commandPaletteGroups(language);
  return {
    [g.navigate]: 0,
    [g.quickSettings]: 1,
    [g.extensions]: 2,
    [g.sessions]: 3,
    [g.files]: 4,
    [g.commands]: 5,
    [g.skills]: 6,
    [g.actions]: 7,
  };
}

export function commandPaletteGroupCaps(language: StoredLanguage): Record<string, number> {
  const g = commandPaletteGroups(language);
  return {
    [g.navigate]: 12,
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

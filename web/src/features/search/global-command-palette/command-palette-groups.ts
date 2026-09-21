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
    [g.connectors]: 2,
    [g.quickSettings]: 3,
    [g.extensions]: 4,
    [g.sessions]: 5,
    [g.files]: 6,
    [g.commands]: 7,
    [g.skills]: 8,
    [g.actions]: 9,
  };
}

export function commandPaletteGroupCaps(language: StoredLanguage): Record<string, number> {
  const g = commandPaletteGroups(language);
  return {
    [g.navigate]: 12,
    [g.projects]: 8,
    [g.connectors]: 6,
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

import { describe, expect, it } from 'vitest';

import {
  commandPaletteGroupCaps,
  commandPaletteGroupSortKey,
} from '@/features/search/global-command-palette/command-palette-groups';
import { messages } from '@/i18n/messages';

describe('connector command palette group', () => {
  it.each(['en', 'zh'] as const)('appears after projects with a six-result cap in %s', (language) => {
    const groups = messages(language).commandPalette.groups;
    const caps = commandPaletteGroupCaps(language);

    expect(commandPaletteGroupSortKey(language, groups.projects)).toBeLessThan(
      commandPaletteGroupSortKey(language, groups.connectors),
    );
    expect(commandPaletteGroupSortKey(language, groups.connectors)).toBeLessThan(
      commandPaletteGroupSortKey(language, groups.quickSettings),
    );
    expect(caps[groups.connectors]).toBe(6);
  });
});

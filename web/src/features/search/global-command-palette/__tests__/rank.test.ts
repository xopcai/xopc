import { describe, expect, it } from 'vitest';

import { hitRank, textMatchRank } from '@/features/search/global-command-palette/rank';

describe('textMatchRank', () => {
  it('prefers exact over prefix over includes', () => {
    expect(textMatchRank('settings', 'settings')).toBe(0);
    expect(textMatchRank('settings', 'set')).toBe(1);
    expect(textMatchRank('open settings panel', 'settings')).toBeGreaterThan(1);
  });

  it('returns null when no match', () => {
    expect(textMatchRank('settings', 'xyz')).toBeNull();
  });
});

describe('hitRank', () => {
  it('matches against title/subtitle/keywords', () => {
    const seed = {
      kind: 'route' as const,
      id: 'route:settings',
      title: 'Settings',
      subtitle: 'Open settings',
      groupLabel: 'Navigate',
      keywords: ['config', 'appearance'],
      run: () => {},
    };

    expect(hitRank(seed, 'settings')).not.toBeNull();
    expect(hitRank(seed, 'config')).not.toBeNull();
    expect(hitRank(seed, 'missing')).toBeNull();
  });
});


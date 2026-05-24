import { describe, expect, it } from 'vitest';

import { formatSessionAge, formatSessionPickerDescription } from '../tui-session-format.js';
import { filterModelsForCycle, modelRef } from '../tui-scoped-models.js';

describe('formatSessionAge', () => {
  it('returns compact relative labels', () => {
    const now = Date.now();
    expect(formatSessionAge(now - 30_000)).toBe('now');
    expect(formatSessionAge(now - 120_000)).toBe('2m');
  });
});

describe('formatSessionPickerDescription', () => {
  it('joins metadata fields', () => {
    const text = formatSessionPickerDescription({
      key: 'webchat:dm:1',
      updatedAt: Date.now() - 3_600_000,
      messageCount: 4,
      totalTokens: 1200,
      model: 'anthropic/claude',
    });
    expect(text).toContain('1h');
    expect(text).toContain('4 msgs');
    expect(text).toContain('anthropic/claude');
  });
});

describe('filterModelsForCycle', () => {
  const catalog = [
    { id: 'a', name: 'A', provider: 'p1' },
    { id: 'b', name: 'B', provider: 'p1' },
    { id: 'c', name: 'C', provider: 'p2' },
  ];

  it('returns full catalog when scoped refs are null', () => {
    expect(filterModelsForCycle(catalog, null)).toHaveLength(3);
  });

  it('preserves scoped order', () => {
    const scoped = [modelRef(catalog[2]!), modelRef(catalog[0]!)];
    expect(filterModelsForCycle(catalog, scoped).map(modelRef)).toEqual(scoped);
  });
});

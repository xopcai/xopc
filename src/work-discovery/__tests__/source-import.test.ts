import { describe, expect, it } from 'vitest';

import { normalizeUnderstandingSourceItems } from '../service.js';

function item(sourceId: string, index: number, text = 'x'.repeat(12_000)) {
  return {
    id: `${sourceId}-${index}`,
    sourceId,
    type: sourceId === 'apple-mail' ? 'mail' : 'document',
    title: `${sourceId} ${index}`,
    text,
    ownerAttribution: 'user',
    sensitivity: 'personal',
    evidenceRef: `${sourceId}://${index}`,
  };
}

describe('normalizeUnderstandingSourceItems', () => {
  it('round-robins sources so a large recent-files scan cannot starve Apple Mail', () => {
    const normalized = normalizeUnderstandingSourceItems([
      ...Array.from({ length: 200 }, (_, index) => item('local-recent-files', index)),
      ...Array.from({ length: 3 }, (_, index) => item('apple-mail', index)),
    ]);

    expect(normalized).toHaveLength(150);
    expect(normalized.filter((entry) => entry.sourceId === 'apple-mail')).toHaveLength(3);
    expect(normalized.slice(0, 6).map((entry) => entry.sourceId)).toEqual([
      'local-recent-files', 'apple-mail',
      'local-recent-files', 'apple-mail',
      'local-recent-files', 'apple-mail',
    ]);
  });

  it('shares the total text budget fairly across selected sources', () => {
    const normalized = normalizeUnderstandingSourceItems([
      ...Array.from({ length: 100 }, (_, index) => item('local-recent-files', index)),
      ...Array.from({ length: 100 }, (_, index) => item('apple-mail', index)),
    ]);
    const bySource = (sourceId: string) => normalized
      .filter((entry) => entry.sourceId === sourceId)
      .reduce((sum, entry) => sum + (entry.text?.length ?? 0), 0);

    expect(normalized.reduce((sum, entry) => sum + (entry.text?.length ?? 0), 0)).toBe(300_000);
    expect(bySource('local-recent-files')).toBe(150_000);
    expect(bySource('apple-mail')).toBe(150_000);
  });
});

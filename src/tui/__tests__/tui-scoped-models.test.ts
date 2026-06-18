import { describe, expect, it } from 'vitest';

import { filterModelsForCycle, modelRef } from '../tui-scoped-models.js';

describe('filterModelsForCycle', () => {
  const catalog = [
    { id: 'a', name: 'A', provider: 'p1' },
    { id: 'b', name: 'B', provider: 'p1' },
    { id: 'c', name: 'C', provider: 'p2' },
  ];

  it('returns full catalog when scoped refs are null', () => {
    expect(filterModelsForCycle(catalog, null)).toHaveLength(3);
  });

  it('returns no models when scoped refs are empty', () => {
    expect(filterModelsForCycle(catalog, [])).toHaveLength(0);
  });

  it('preserves scoped order', () => {
    const scoped = [modelRef(catalog[2]!), modelRef(catalog[0]!)];
    expect(filterModelsForCycle(catalog, scoped).map(modelRef)).toEqual(scoped);
  });
});

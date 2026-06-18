import { describe, expect, it } from 'vitest';

import { truncateToVisualLines } from '../components/visual-truncate.js';

describe('visual truncate', () => {
  it('truncates by rendered rows rather than source lines', () => {
    const result = truncateToVisualLines('abcdefghijklmno', 2, 5, 0);
    expect(result.visualLines).toHaveLength(2);
    expect(result.skippedCount).toBeGreaterThan(0);
  });
});

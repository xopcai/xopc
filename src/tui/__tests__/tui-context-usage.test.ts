import { describe, expect, it } from 'vitest';

import { computeContextUsagePercent, formatContextUsageLabel } from '../tui-context-usage.js';

describe('tui-context-usage', () => {
  it('formats context percent', () => {
    expect(computeContextUsagePercent(50_000, 100_000)).toBe(50);
    expect(formatContextUsageLabel(50)).toBe('50% ctx');
    expect(formatContextUsageLabel(50, 100_000)).toBe('50%/100k ctx');
    expect(formatContextUsageLabel(null, 128_000)).toBe('?/128k ctx');
  });
});

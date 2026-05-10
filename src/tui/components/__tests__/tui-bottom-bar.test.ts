import { describe, expect, it } from 'vitest';

import { formatTokens } from '../tui-bottom-bar.js';

describe('formatTokens', () => {
  it('formats sub-thousand literally', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('uses one decimal for 1k–10k', () => {
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(9999)).toBe('10.0k');
  });

  it('rounds whole k for 10k–1M', () => {
    expect(formatTokens(12_400)).toBe('12k');
    expect(formatTokens(205_000)).toBe('205k');
  });
});

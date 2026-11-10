import { describe, expect, it, vi } from 'vitest';

import { createMathBudget } from '../markdown/math-budget';

describe('streaming math scan budget', () => {
  it('only scans changed blocks in a 500-block answer', () => {
    const count = vi.fn(() => 1);
    const budget = createMathBudget(count);
    const blocks = Array.from({ length: 500 }, (_, i) => `block ${i}`);
    expect(budget(blocks).slice(254, 258)).toEqual([2, 1, 0, 0]);
    count.mockClear();
    for (let delta = 0; delta < 100; delta++) {
      blocks[499] += 'x';
      budget(blocks);
    }
    expect(count).toHaveBeenCalledTimes(100);
  });

  it('preserves context identity until a downstream math allowance changes', () => {
    const budget = createMathBudget(source => source.includes('$') ? 1 : 0);
    const first = budget(['done', 'tail']);
    expect(budget(['done', 'tail grows'])).toBe(first);
    // Math in the last block does not affect any earlier block's allowance.
    expect(budget(['done', '$x$'])).toBe(first);
    const changed = budget(['$x$', 'tail']);
    expect(changed).not.toBe(first);
    expect(changed).toEqual([256, 255]);
  });

  it('recomputes replacements, truncations and math limits correctly', () => {
    const budget = createMathBudget(source => source.length);
    expect(budget(['x'.repeat(255), 'xx', 'z'])).toEqual([256, 1, 0]);
    expect(budget(['a', 'b'])).toEqual([256, 255]);
    expect(budget(['a'])).toEqual([256]);
    expect(budget([])).toEqual([]);
    expect(budget(['a', 'b'])).toEqual([256, 255]);
  });
});

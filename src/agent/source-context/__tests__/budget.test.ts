import { describe, expect, it } from 'vitest';

import { fitSourceContextsToBudget } from '../budget.js';
import type { AgentSourceContext } from '../types.js';

function context(id: string, text: string): AgentSourceContext {
  return { kind: 'note', sourceId: id, version: '1', title: id, text };
}

describe('fitSourceContextsToBudget', () => {
  it('shares the aggregate budget across selected notes without dropping one', () => {
    const result = fitSourceContextsToBudget([
      context('a', 'a'.repeat(400)),
      context('b', 'b'.repeat(400)),
    ], 100);

    expect(result).toHaveLength(2);
    expect(result.every((item) => item.text.length <= 200)).toBe(true);
    expect(result.every((item) => item.truncated)).toBe(true);
    expect(result.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(400);
  });

  it('never exceeds very small or zero budgets', () => {
    expect(fitSourceContextsToBudget([context('a', 'body')], 0)[0]?.text).toBe('');
    const tiny = fitSourceContextsToBudget([context('a', 'long body')], 1)[0];
    expect(tiny?.text.length).toBeLessThanOrEqual(4);
    expect(tiny?.truncated).toBe(true);
  });
});

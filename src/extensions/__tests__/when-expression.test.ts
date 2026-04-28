import { describe, expect, it } from 'vitest';

import { evaluateWhenExpression } from '../when-expression.js';

describe('evaluateWhenExpression', () => {
  it('empty is true', () => {
    expect(evaluateWhenExpression('', {})).toBe(true);
  });

  it('boolean variable', () => {
    expect(
      evaluateWhenExpression('hasProvider.openai', { 'hasProvider.openai': true }),
    ).toBe(true);
    expect(
      evaluateWhenExpression('hasProvider.openai', { 'hasProvider.openai': false }),
    ).toBe(false);
  });

  it('and / or', () => {
    const ctx = { 'hasProvider.openai': true, isElectron: false };
    expect(evaluateWhenExpression('hasProvider.openai && !isElectron', ctx)).toBe(true);
    expect(evaluateWhenExpression('hasProvider.openai || isElectron', ctx)).toBe(true);
  });

  it('platform equality', () => {
    expect(evaluateWhenExpression('platform == "darwin"', { platform: 'linux' })).toBe(
      false,
    );
    expect(evaluateWhenExpression('platform == "linux"', { platform: 'linux' })).toBe(
      true,
    );
  });
});

import { describe, expect, it } from 'vitest';

import { resolveModel } from '../index.js';

describe('resolveModel', () => {
  it('throws a setup-oriented error for an empty model ref', () => {
    expect(() => resolveModel('')).toThrow(
      'No default model configured. Choose a model in onboarding',
    );
    expect(() => resolveModel('   ')).toThrow(
      'No default model configured. Choose a model in onboarding',
    );
  });
});

import { describe, expect, it } from 'vitest';

import { recurringWorkStage } from './recurring-work-model';

describe('recurring work plan stage', () => {
  it('recognizes each explicit design state', () => {
    expect(recurringWorkStage(['recurring-work-spec', 'recurring-work-draft'])).toBe('draft');
    expect(recurringWorkStage(['recurring-work-spec', 'recurring-work-ready'])).toBe('ready');
    expect(recurringWorkStage(['recurring-work-spec', 'recurring-work-configured'])).toBe('configured');
  });

  it('keeps old and conflicting plans out of the prepare flow', () => {
    expect(recurringWorkStage(['recurring-work-spec'])).toBe('needs_review');
    expect(recurringWorkStage(['recurring-work-spec', 'recurring-work-draft', 'recurring-work-ready'])).toBe('needs_review');
  });
});

import { describe, expect, it } from 'vitest';

import { shouldShowHomeAttention } from '../home-attention';

describe('shouldShowHomeAttention', () => {
  it('hides the section when there is no action to take', () => {
    expect(shouldShowHomeAttention(0, 0)).toBe(false);
  });

  it.each([[1, 0], [0, 1], [2, 3]])('shows the section when attention exists', (inboxCount, itemCount) => {
    expect(shouldShowHomeAttention(inboxCount, itemCount)).toBe(true);
  });
});

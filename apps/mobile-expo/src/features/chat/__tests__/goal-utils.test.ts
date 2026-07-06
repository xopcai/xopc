import { describe, expect, it } from 'vitest';

import { goalMissionExpandedMaxHeight } from '../goal-utils';

describe('goalMissionExpandedMaxHeight', () => {
  it('scales with window height but stays within bounds', () => {
    expect(goalMissionExpandedMaxHeight(600)).toBe(288);
    expect(goalMissionExpandedMaxHeight(1200)).toBe(460);
    expect(goalMissionExpandedMaxHeight(400)).toBe(220);
  });
});

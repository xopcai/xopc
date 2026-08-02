import { describe, expect, it } from 'vitest';

import {
  createDesktopPetRelationship,
  desktopPetDaysTogether,
  recordDesktopPetCompletion,
  recordDesktopPetVisit,
} from '../relationship-state.js';

describe('desktop pet relationship', () => {
  it('starts without debt and counts the first day', () => {
    const state = createDesktopPetRelationship(1_000);
    expect(state.completedTaskCount).toBe(0);
    expect(desktopPetDaysTogether(state, 1_000)).toBe(1);
  });

  it('recognizes a new local day without reducing progress', () => {
    const before = createDesktopPetRelationship(new Date(2026, 0, 1, 23).getTime());
    const result = recordDesktopPetVisit(before, new Date(2026, 0, 2, 8).getTime());
    expect(result.moment).toBe('new_day');
    expect(result.relationship.completedTaskCount).toBe(0);
  });

  it('counts each run once and unlocks only positive milestones', () => {
    let state = createDesktopPetRelationship(1_000);
    state = recordDesktopPetCompletion(state, 'run-1', 2_000);
    state = recordDesktopPetCompletion(state, 'run-1', 3_000);
    expect(state.completedTaskCount).toBe(1);
    expect(state.unlockedReactions).toEqual(['first_task']);
  });
});

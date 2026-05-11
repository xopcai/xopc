import { describe, expect, it } from 'vitest';

import { applyChecklistUserMutation } from '../checklist-user.js';
import { PERSISTENT_GOAL_CUSTOM_KEY, serializePersistentGoal } from '../state.js';

describe('applyChecklistUserMutation', () => {
  it('adds a user checklist item', () => {
    const base = {
      [PERSISTENT_GOAL_CUSTOM_KEY]: serializePersistentGoal({
        goal: 'Ship it',
        status: 'active',
        turnsUsed: 0,
        maxTurns: 5,
        createdAt: 1,
        lastTurnAt: 0,
        decomposed: true,
        checklist: [],
      }),
    };
    const r = applyChecklistUserMutation(base, { type: 'add', text: ' CI green ' });
    expect(r.kind).toBe('updated');
    if (r.kind !== 'updated') return;
    const goal = r.customData[PERSISTENT_GOAL_CUSTOM_KEY] as { checklist: { text: string; addedBy: string }[] };
    expect(goal.checklist).toHaveLength(1);
    expect(goal.checklist[0]!.text).toBe('CI green');
    expect(goal.checklist[0]!.addedBy).toBe('user');
  });
});

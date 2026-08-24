import { describe, expect, it } from 'vitest';

import type { HomeFocusItem } from '../../../query/home';
import { rankHomeContinueCandidates, selectHomeFocusItem } from '../home-presentation';

describe('home presentation', () => {
  it('prefers recently used content over background work and removes the focused item', () => {
    const now = 2_000_000_000;
    const ranked = rankHomeContinueCandidates([
      { id: 'workflow:1', kind: 'running_work', updatedAt: now, value: 'workflow' },
      { id: 'session:1', kind: 'recent_chat', updatedAt: now - 1_000, value: 'session' },
      { id: 'note:1', kind: 'note', updatedAt: now - 2_000, value: 'note' },
    ], 'note:1', now);

    expect(ranked).toEqual(['session', 'workflow']);
  });

  it('never lets a pin hide an operational alert', () => {
    const items = [
      { id: 'decision:1', kind: 'decision', pinnable: false },
      { id: 'task:1', kind: 'running', pinnable: true },
    ] as HomeFocusItem[];

    expect(selectHomeFocusItem(items, 'task:1')?.id).toBe('decision:1');
    expect(selectHomeFocusItem(items, 'decision:1')?.id).toBe('decision:1');
  });

  it('uses a valid pin when no operational alert is present', () => {
    const items = [
      { id: 'result:1', kind: 'result', pinnable: true },
      { id: 'task:1', kind: 'running', pinnable: true },
    ] as HomeFocusItem[];

    expect(selectHomeFocusItem(items, 'task:1')?.id).toBe('task:1');
  });
});

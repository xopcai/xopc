import { describe, expect, it } from 'vitest';

import { setOptimisticUserMessageDelivery } from '../optimistic-user-message';
import type { Message } from '../messages.types';

const optimistic = (id: string): Message => ({
  role: 'user',
  content: [{ type: 'text', text: id }],
  deliveryStatus: 'sending',
  clientSubmissionId: id,
  pendingAppContext: {
    version: 1,
    clientInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tabId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    sequence: 1,
    surface: 'web',
    capturedAt: 1,
    resourceRefs: [],
  },
});

describe('optimistic user message delivery', () => {
  it('marks only the matching submission as failed', () => {
    const messages = [optimistic('first'), optimistic('second')];

    const next = setOptimisticUserMessageDelivery(messages, 'first', 'failed');

    expect(next[0]).toMatchObject({ clientSubmissionId: 'first', deliveryStatus: 'failed' });
    expect(next[1]).toMatchObject({ clientSubmissionId: 'second', deliveryStatus: 'sending' });
  });

  it('retains accepted input identity until the canonical transcript row arrives', () => {
    const [accepted] = setOptimisticUserMessageDelivery([optimistic('first')], 'first', 'accepted');

    expect(accepted).toMatchObject({ clientSubmissionId: 'first', deliveryStatus: 'accepted' });
    expect(accepted).not.toHaveProperty('pendingAppContext');
  });

  it('does not mark a canonical row as failed when an older send callback finishes', () => {
    const canonical = { ...optimistic('first'), deliveryStatus: undefined, turnId: 'run-1' };
    expect(setOptimisticUserMessageDelivery([canonical], 'first', 'failed')[0]).toBe(canonical);
  });
});

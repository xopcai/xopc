import { describe, expect, it } from 'vitest';

import { projectPendingFollowUps } from '../follow-up/pending-follow-up.types';

const row = (status: string) => ({
  id: status,
  clientMessageId: `client-${status}`,
  content: status,
  version: 1,
  effectiveDelivery: status === 'injecting' ? 'steer' : 'next',
  status,
});

describe('projectPendingFollowUps', () => {
  it('shows only inputs that still need user-visible queue handling', () => {
    expect(projectPendingFollowUps([
      row('queued'),
      row('running'),
      row('injecting'),
      row('interrupted'),
    ]).map((input) => input.status)).toEqual(['queued', 'interrupted']);
  });
});

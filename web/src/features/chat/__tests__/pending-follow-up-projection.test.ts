import { describe, expect, it } from 'vitest';

import { projectPendingFollowUps, projectVisiblePendingFollowUps } from '../follow-up/pending-follow-up.types';

const row = (status: string) => ({
  id: status,
  clientMessageId: `client-${status}`,
  content: status,
  version: 1,
  effectiveDelivery: status === 'injecting' ? 'steer' : 'next',
  status,
});

describe('projectVisiblePendingFollowUps', () => {
  it('hides the first unclaimed turn while preparation is in progress', () => {
    const inputs = [{ ...row('queued'), id: 'first' }, { ...row('queued'), id: 'second' }];
    expect(projectVisiblePendingFollowUps({ inputs, preparation: { state: 'preparing' } }).map((input) => input.id)).toEqual(['second']);
    expect(projectVisiblePendingFollowUps({ inputs, activeRunId: 'run-1' }).map((input) => input.id)).toEqual(['first', 'second']);
    expect(projectVisiblePendingFollowUps({ inputs, preparation: { state: 'preparation_failed' } }).map((input) => input.id)).toEqual(['first', 'second']);
  });
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

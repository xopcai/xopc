import { describe, expect, it } from 'vitest';

import { idleOperationState, reduceOperationState } from '../operation-state';

describe('reduceOperationState', () => {
  it('makes an async action visibly pending before it completes', () => {
    expect(reduceOperationState(idleOperationState, { type: 'start' })).toEqual({ status: 'pending' });
  });

  it('preserves a recoverable error until the user dismisses or retries it', () => {
    const failed = reduceOperationState(idleOperationState, { type: 'fail', message: 'Unable to start chat.' });

    expect(failed).toEqual({ status: 'error', message: 'Unable to start chat.' });
    expect(reduceOperationState(failed, { type: 'dismiss' })).toEqual(idleOperationState);
    expect(reduceOperationState(failed, { type: 'start' })).toEqual({ status: 'pending' });
  });
});

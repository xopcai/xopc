import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelAllEndpointConfirmations,
  requestEndpointConfirmation,
  settleEndpointConfirmation,
} from '../confirmation-store';

describe('endpoint tool confirmation store', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
  });

  afterEach(() => {
    cancelAllEndpointConfirmations();
    vi.unstubAllGlobals();
  });

  it('resolves asynchronously when the user decides', async () => {
    const decision = requestEndpointConfirmation({
      invocationId: 'invocation-1',
      title: 'Write clipboard',
      remember: true,
      deadlineAt: Date.now() + 10_000,
    });
    settleEndpointConfirmation('invocation-1', true);
    await expect(decision).resolves.toBe(true);
  });

  it('denies pending confirmations when the host stops', async () => {
    const decision = requestEndpointConfirmation({
      invocationId: 'invocation-2',
      title: 'Navigate',
      remember: true,
      deadlineAt: Date.now() + 10_000,
    });
    cancelAllEndpointConfirmations();
    await expect(decision).resolves.toBe(false);
  });
});

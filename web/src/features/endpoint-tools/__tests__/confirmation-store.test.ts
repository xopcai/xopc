import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelAllEndpointConfirmations,
  formatEndpointToolArguments,
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

  it('shows actual arguments with a bounded preview', () => {
    expect(formatEndpointToolArguments({ url: 'https://example.com' })).toContain('https://example.com');
    expect(formatEndpointToolArguments({ text: 'x'.repeat(1_000) }).length).toBeLessThan(700);
  });

  it('resolves asynchronously when the user decides', async () => {
    const decision = requestEndpointConfirmation({
      invocationId: 'invocation-1',
      title: 'Write clipboard',
      args: { text: 'hello' },
      deadlineAt: Date.now() + 10_000,
    });
    settleEndpointConfirmation('invocation-1', true);
    await expect(decision).resolves.toBe(true);
  });

  it('denies pending confirmations when the host stops', async () => {
    const decision = requestEndpointConfirmation({
      invocationId: 'invocation-2',
      title: 'Navigate',
      args: { url: 'https://example.com' },
      deadlineAt: Date.now() + 10_000,
    });
    cancelAllEndpointConfirmations();
    await expect(decision).resolves.toBe(false);
  });
});

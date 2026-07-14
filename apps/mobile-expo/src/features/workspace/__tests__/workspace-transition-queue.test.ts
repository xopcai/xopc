import { describe, expect, it } from 'vitest';

import { shouldQueueWorkspaceOpen } from '../workspace-transition-queue';

describe('shouldQueueWorkspaceOpen', () => {
  it('queues a new conversation request while the previous overlay is closing', () => {
    expect(shouldQueueWorkspaceOpen('closing')).toBe(true);
  });

  it.each(['closed', 'opening', 'open'] as const)('does not queue while %s', (phase) => {
    expect(shouldQueueWorkspaceOpen(phase)).toBe(false);
  });
});

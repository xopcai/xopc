import { describe, expect, it } from 'vitest';

import { shouldDismissClarificationForTerminal } from '../agent-stream-messaging-callbacks';

describe('clarification terminal state', () => {
  it('keeps a durable clarification visible when its originating run is suspended', () => {
    expect(shouldDismissClarificationForTerminal('suspended')).toBe(false);
  });

  it.each(['success', 'error', 'cancelled'] as const)('clears clarification after %s', (status) => {
    expect(shouldDismissClarificationForTerminal(status)).toBe(true);
  });
});

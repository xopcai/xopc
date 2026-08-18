import { describe, expect, it } from 'vitest';

import { countPendingChatInputs } from '../tui-backend.js';

describe('countPendingChatInputs', () => {
  it('excludes inputs that already entered a turn', () => {
    expect(countPendingChatInputs([
      { id: 'queued', status: 'queued' },
      { id: 'running', status: 'running' },
      { id: 'injecting', status: 'injecting' },
      { id: 'interrupted', status: 'interrupted' },
    ])).toBe(2);
  });
});

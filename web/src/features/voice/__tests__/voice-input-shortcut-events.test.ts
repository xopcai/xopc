import { describe, expect, it } from 'vitest';

import {
  queuePendingVoiceInputToggle,
  takePendingVoiceInputToggle,
} from '../voice-input-shortcut-events';

describe('voice input shortcut pending handoff', () => {
  it('hands an unmatched shortcut to the next mounted chat composer once', () => {
    expect(takePendingVoiceInputToggle()).toBe(false);
    queuePendingVoiceInputToggle();
    expect(takePendingVoiceInputToggle()).toBe(true);
    expect(takePendingVoiceInputToggle()).toBe(false);
  });
});

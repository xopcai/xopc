import { describe, expect, it } from 'vitest';

import {
  clearPendingVoiceInputToggle,
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

  it('clears a pending press when the system hotkey is released before mount', () => {
    queuePendingVoiceInputToggle();
    clearPendingVoiceInputToggle();
    expect(takePendingVoiceInputToggle()).toBe(false);
  });
});

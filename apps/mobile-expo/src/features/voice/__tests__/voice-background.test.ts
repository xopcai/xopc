import { describe, expect, it } from 'vitest';
import { shouldPauseVoiceForBackground, type CallState } from '../voice-call-controller';

const state = (phase: CallState['phase'], background = false): CallState => ({
  phase, target: { gatewayId: 'gateway', sessionKey: 'test', background }, name: '',
  expanded: true, muted: false, startedAt: 0, userText: '', assistantText: '',
});

describe('voice background handling', () => {
  it.each(['connecting', 'recovering'] as const)('does not cancel %s for its microphone permission activity', phase => {
    expect(shouldPauseVoiceForBackground(state(phase), true)).toBe(false);
    expect(shouldPauseVoiceForBackground(state(phase), false)).toBe(true);
  });
  it('still pauses an active foreground-only call', () => {
    expect(shouldPauseVoiceForBackground(state('connected'), false)).toBe(true);
    expect(shouldPauseVoiceForBackground(state('connected'), true)).toBe(true);
    expect(shouldPauseVoiceForBackground(state('connected', true), false)).toBe(false);
  });
  it.each(['idle', 'ending', 'paused'] as const)('does not overwrite the reason for a %s call', phase => {
    expect(shouldPauseVoiceForBackground(state(phase), false)).toBe(false);
  });
});

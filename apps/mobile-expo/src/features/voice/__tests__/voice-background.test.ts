import { describe, expect, it } from 'vitest';
import { shouldPauseVoiceForBackground, shouldResumeVoiceAfterForeground, type CallState } from '../voice-call-controller';

const state = (phase: CallState['phase'], background = false): CallState => ({
  phase, target: { gatewayId: 'gateway', sessionKey: 'test', background }, name: '',
  expanded: true, muted: false, startedAt: 0, userText: '', assistantText: '', networkQuality: 'good',
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
  it('resumes a foreground-only call when the app returns to the foreground', () => {
    expect(shouldResumeVoiceAfterForeground({ ...state('paused'), error: 'background' })).toBe(true);
    expect(shouldResumeVoiceAfterForeground({ ...state('paused'), error: 'NETWORK' })).toBe(false);
    expect(shouldResumeVoiceAfterForeground({ ...state('paused', true), error: 'background' })).toBe(false);
  });
});

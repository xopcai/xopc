import { describe, expect, it } from 'vitest';

import { en } from '../../../i18n/locales/en';
import { voiceErrorMessage } from '../voice-error';

describe('voiceErrorMessage', () => {
  it.each([
    ['audio_focus_lost', en.voice.audioFocusLost],
    ['capture_failed', en.voice.captureFailed],
    ['route_lost', en.voice.routeLost],
    ['background', en.voice.backgroundPaused],
    ['interruption', en.voice.interruption],
  ])('distinguishes audio interruption reason %s', (code, message) => {
    expect(voiceErrorMessage(code, en.voice)).toBe(message);
  });

  it.each([
    'AUDIO_FOCUS_UNAVAILABLE',
    'MICROPHONE_UNAVAILABLE',
    'MICROPHONE_FORMAT_UNAVAILABLE',
  ])('maps Android audio acquisition failure %s to the actionable busy message', (code) => {
    expect(voiceErrorMessage(code, en.voice)).toBe(en.voice.busy);
  });

  it('keeps Android security failures actionable as microphone permission errors', () => {
    expect(voiceErrorMessage('PERMISSION_DENIED', en.voice)).toBe(en.voice.permission);
  });
});
